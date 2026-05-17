"""Curate a bhavageete vocal+accompaniment corpus for v1.4 Sprint 8.

Pipeline:
    raw audio sources -> per-clip segmentation -> loudness normalisation
        -> non-vocal VAD strip -> forced-alignment -> caption (raga,
        tala, instrumentation, mood, tempo, lyrics snippet)
        -> HF dataset `neo-fm/bhavageete-corpus-v1`.

This script is **operator-driven** on the DGX Spark. It is intentionally
not a CI workload: alignment with MFA needs the Kannada lexicon, VAD
needs Silero, captioning calls into a local Qwen2.5-72B instance via
`ollama` or `vllm`, and several stages benefit from operator review.

Source manifests live in `data/bhavageete-sources.yaml` (gitignored: it
contains licensing notes per source). The CLI:

    python curate_bhavageete.py \
        --manifest ../../../data/bhavageete-sources.yaml \
        --out ./corpus/bhavageete-v1 \
        --target-clip-seconds 30 \
        --max-hours 4

Stages can be run independently via `--stage download|segment|vad|align|caption|export`
so the operator can resume after a manual review break.

This file holds *only* the orchestration scaffold and a deterministic
in-memory dry-run path. The heavy lifting (yt-dlp, pyloudnorm, WhisperX,
Silero VAD, MFA, Qwen call) is gated behind `--dry-run` so CI exercises
shape without pulling those deps.

References:
- ADR 0028 (v1.4 Sprint 8): bhavageete LoRA on HeartMuLa.
- Research-3 §Stage D for the LoRA recipe (rank 32 chosen here).
- AGENTS.md "Compute rule (v1.4+)": all GPU work runs on DGX Spark.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

LOG = logging.getLogger("curate_bhavageete")


@dataclass
class SourceClip:
    """A single source clip referenced in the manifest.

    `id` is a stable hash of (source_id, start_seconds, end_seconds) and
    is used as the on-disk filename. `license` is mandatory — clips
    without a clear license assertion are refused by `validate_manifest`.
    """
    id: str
    source_id: str
    title: str
    artist: str
    language: str
    start_seconds: float
    end_seconds: float
    license: str  # 'pd-india' | 'pd-us' | 'cc-by' | 'cc-by-nc-sa' | 'fair-use-§52'
    source_url: str
    notes: str = ""


@dataclass
class Caption:
    """The structured caption attached to each clip."""
    raga: str | None = None
    tala: str | None = None
    tempo_bpm: int | None = None
    instrumentation: list[str] = field(default_factory=list)
    mood: str | None = None
    lyrics_snippet: str | None = None
    composer: str | None = None
    lyricist: str | None = None
    reviewer: str | None = None
    review_status: str = "pending"  # 'pending' | 'approved' | 'rejected'


def _clip_id(source_id: str, start: float, end: float) -> str:
    h = hashlib.sha1(f"{source_id}|{start:.3f}|{end:.3f}".encode("utf-8")).hexdigest()
    return h[:12]


def load_manifest(path: Path) -> list[SourceClip]:
    """Load and validate the source manifest.

    Manifest format (YAML)::

        - source_id: air-bengaluru-bendre-1965
          title: Bayalu
          artist: Da Ra Bendre (composer), unknown vocalist
          language: kn
          start_seconds: 12.0
          end_seconds: 42.0
          license: fair-use-§52
          source_url: https://archive.org/details/...
          notes: AIR Bengaluru broadcast pre-1972; Bendre died 1981 but
                 the broadcast itself is fair-use §52(1)(zb) for
                 research use; cleared with legal.
    """
    if not path.exists():
        raise FileNotFoundError(f"manifest not found: {path}")
    import yaml  # type: ignore[import-not-found]

    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(
            f"manifest at {path} must be a YAML list of source clips"
        )
    clips: list[SourceClip] = []
    for i, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise ValueError(f"manifest entry #{i} is not a mapping")
        clip = SourceClip(
            id=entry.get("id")
            or _clip_id(
                entry["source_id"],
                float(entry["start_seconds"]),
                float(entry["end_seconds"]),
            ),
            source_id=entry["source_id"],
            title=entry["title"],
            artist=entry["artist"],
            language=entry["language"],
            start_seconds=float(entry["start_seconds"]),
            end_seconds=float(entry["end_seconds"]),
            license=entry["license"],
            source_url=entry["source_url"],
            notes=entry.get("notes", ""),
        )
        clips.append(clip)
    return clips


def validate_manifest(clips: Iterable[SourceClip]) -> None:
    """Raise if the manifest violates the corpus invariants.

    Invariants:
      - language is 'kn' for every clip (Sprint 8 is Kannada-only).
      - license is one of the allowed assertions.
      - end > start, and clip is at most 60s (we cut to 30s downstream).
      - source_url is http(s).
    """
    allowed_licenses = {
        "pd-india",
        "pd-us",
        "cc-by",
        "cc-by-nc-sa",
        "fair-use-§52",
    }
    for clip in clips:
        if clip.language != "kn":
            raise ValueError(
                f"clip {clip.id}: language={clip.language!r}, expected 'kn'"
            )
        if clip.license not in allowed_licenses:
            raise ValueError(
                f"clip {clip.id}: license={clip.license!r} not in {allowed_licenses}"
            )
        if clip.end_seconds <= clip.start_seconds:
            raise ValueError(
                f"clip {clip.id}: end_seconds <= start_seconds"
            )
        if clip.end_seconds - clip.start_seconds > 60.0:
            raise ValueError(
                f"clip {clip.id}: clip longer than 60s; pre-cut in manifest"
            )
        if not clip.source_url.lower().startswith(("http://", "https://")):
            raise ValueError(f"clip {clip.id}: source_url not http(s)")


def emit_manifest_summary(clips: list[SourceClip], out_dir: Path) -> dict[str, Any]:
    """Produce the deterministic summary JSON the LoRA trainer reads.

    The trainer needs:
      - total seconds of audio
      - per-license breakdown (for the dataset card)
      - clip count per source
      - the stable clip-id list for `train` and `eval` splits

    Splits are 90/10 by clip-id hash so re-running with the same
    manifest produces the same split — eval set stability is critical
    for MOS A/B testing across sprints.
    """
    total_seconds = sum(c.end_seconds - c.start_seconds for c in clips)
    by_license: dict[str, float] = {}
    by_source: dict[str, int] = {}
    train: list[str] = []
    eval_split: list[str] = []
    for c in clips:
        secs = c.end_seconds - c.start_seconds
        by_license[c.license] = by_license.get(c.license, 0.0) + secs
        by_source[c.source_id] = by_source.get(c.source_id, 0) + 1
        bucket = int(hashlib.sha1(c.id.encode("utf-8")).hexdigest(), 16) % 10
        (eval_split if bucket == 0 else train).append(c.id)
    summary = {
        "clip_count": len(clips),
        "total_hours": round(total_seconds / 3600.0, 3),
        "by_license_seconds": {k: round(v, 1) for k, v in by_license.items()},
        "by_source_clips": by_source,
        "splits": {
            "train_clip_ids": sorted(train),
            "eval_clip_ids": sorted(eval_split),
        },
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8"
    )
    (out_dir / "clips.jsonl").write_text(
        "\n".join(json.dumps(asdict(c), sort_keys=True) for c in clips) + "\n",
        encoding="utf-8",
    )
    return summary


def run_dry(manifest_path: Path, out_dir: Path) -> dict[str, Any]:
    """Validate manifest + emit summary without touching audio.

    This is the path CI/operator-smoke runs. The real download/VAD/MFA
    stages are gated behind `--stage ...` and require the heavy deps.
    """
    clips = load_manifest(manifest_path)
    validate_manifest(clips)
    return emit_manifest_summary(clips, out_dir)


def run_full(manifest_path: Path, out_dir: Path, *, stage: str) -> dict[str, Any]:  # pragma: no cover
    """Operator path; lazy-imports yt-dlp, pyloudnorm, WhisperX, etc.

    Not exercised in CI (no GPU, no audio deps).
    """
    if stage in ("all", "validate"):
        return run_dry(manifest_path, out_dir)

    # The remaining stages are pure orchestration stubs at this commit;
    # they document the contract the operator runs on DGX. Each stage
    # writes its output back next to summary.json so the trainer in
    # `train_bhavageete_lora.py` can pick up partial state.
    raise NotImplementedError(
        f"Stage {stage!r} is operator-driven on DGX. See docs/DECISIONS/0028 "
        f"for the runbook. Use --dry-run to validate the manifest in CI."
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Curate bhavageete corpus for v1.4 Sprint 8."
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        required=True,
        help="Path to bhavageete-sources.yaml",
    )
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Output directory for summary.json + clips.jsonl + stage artefacts",
    )
    parser.add_argument(
        "--stage",
        choices=["validate", "download", "segment", "vad", "align", "caption", "export", "all"],
        default="validate",
        help="Pipeline stage to run; 'validate' is the CI default",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate manifest + emit summary; skip all GPU/network stages",
    )
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    if args.dry_run or args.stage == "validate":
        summary = run_dry(args.manifest, args.out)
    else:
        summary = run_full(args.manifest, args.out, stage=args.stage)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
