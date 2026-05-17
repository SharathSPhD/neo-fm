"""Shared corpus-pipeline primitives for v1.4 Sprints 8/9/14.

Both `curate_bhavageete.py` (Sprint 8, Kannada light-classical) and
`curate_tamil_folk.py` (Sprint 9, Tamil parai/janapada) follow the same
recipe with two style-specific knobs:

  - `language`: the ISO code every manifest entry must use ('kn', 'ta',
    'sa' for shloka in Sprint 14).
  - `allowed_licenses`: the license assertions valid for that style's
    source landscape. Bhavageete leans on AIR fair-use; Tamil folk
    leans on CC-BY festival recordings; shlokas lean on PD.

The deterministic, CI-runnable parts (manifest load, license validate,
summary + splits) all live here. The audio-touching stages
(`download`, `segment`, `vad`, `align`, `caption`, `export`) stay in
the per-style scripts because they have style-specific tunings (parai
VAD thresholds vs harmonium-friendly thresholds, etc).

Splits are 90/10 by SHA-1 hash of the clip id so the same manifest
yields the same split across re-runs and across styles — eval-set
stability is what makes Sprint 16's MOS A/B comparable across LoRAs.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable


@dataclass
class SourceClip:
    """A single source clip referenced in the manifest.

    `id` is a stable hash of (source_id, start_seconds, end_seconds);
    `license` is mandatory — clips without a clear license assertion
    are refused by `validate_manifest`.
    """
    id: str
    source_id: str
    title: str
    artist: str
    language: str
    start_seconds: float
    end_seconds: float
    license: str
    source_url: str
    notes: str = ""


@dataclass
class Caption:
    """The structured caption attached to each clip after stage 6.

    Used by the trainer's `Dataset.__getitem__` to assemble the
    (tags, lyrics, audio) tuple HeartMuLa expects.
    """
    raga: str | None = None
    tala: str | None = None
    tempo_bpm: int | None = None
    instrumentation: list[str] = field(default_factory=list)
    mood: str | None = None
    lyrics_snippet: str | None = None
    composer: str | None = None
    lyricist: str | None = None
    reviewer: str | None = None
    review_status: str = "pending"


# Master list of license assertions our corpus pipeline accepts. Each
# style chooses a subset.
ALL_LICENSES: frozenset[str] = frozenset(
    {
        "pd-india",      # public domain in India per §28
        "pd-us",         # public domain in US per pre-1928 / pre-1972
        "cc-by",
        "cc-by-sa",
        "cc-by-nc",
        "cc-by-nc-sa",
        "fair-use-§52",  # Indian Copyright Act §52(1)(zb)
    }
)


def clip_id(source_id: str, start: float, end: float) -> str:
    """Stable hash used as both the on-disk filename and the split key."""
    h = hashlib.sha1(
        f"{source_id}|{start:.3f}|{end:.3f}".encode("utf-8")
    ).hexdigest()
    return h[:12]


def load_manifest(path: Path) -> list[SourceClip]:
    """Load a YAML manifest into typed SourceClip objects.

    Manifest format (YAML)::

        - source_id: <stable-id>
          title: <work-title>
          artist: <composer-or-performer>
          language: <iso-639-1>
          start_seconds: 12.0
          end_seconds: 42.0
          license: pd-india | cc-by | fair-use-§52 | ...
          source_url: https://...
          notes: <prose-comment-shown-to-operator-reviewer>
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
        clips.append(
            SourceClip(
                id=entry.get("id")
                or clip_id(
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
        )
    return clips


def validate_manifest(
    clips: Iterable[SourceClip],
    *,
    expected_language: str,
    allowed_licenses: frozenset[str],
    max_clip_seconds: float = 60.0,
) -> None:
    """Raise on any per-clip invariant violation.

    Invariants:
      - `language == expected_language`
      - `license in allowed_licenses`
      - `end > start` and clip is at most `max_clip_seconds`
      - `source_url` is http(s)
    """
    if not allowed_licenses.issubset(ALL_LICENSES):
        bad = allowed_licenses - ALL_LICENSES
        raise ValueError(
            f"allowed_licenses contains unknown values: {sorted(bad)}"
        )
    for clip in clips:
        if clip.language != expected_language:
            raise ValueError(
                f"clip {clip.id}: language={clip.language!r}, "
                f"expected {expected_language!r}"
            )
        if clip.license not in allowed_licenses:
            raise ValueError(
                f"clip {clip.id}: license={clip.license!r} not allowed "
                f"for this style; allowed: {sorted(allowed_licenses)}"
            )
        if clip.end_seconds <= clip.start_seconds:
            raise ValueError(
                f"clip {clip.id}: end_seconds <= start_seconds"
            )
        if clip.end_seconds - clip.start_seconds > max_clip_seconds:
            raise ValueError(
                f"clip {clip.id}: clip longer than {max_clip_seconds}s; "
                f"pre-cut in manifest"
            )
        if not clip.source_url.lower().startswith(("http://", "https://")):
            raise ValueError(f"clip {clip.id}: source_url not http(s)")


def emit_manifest_summary(
    clips: list[SourceClip], out_dir: Path
) -> dict[str, Any]:
    """Write summary.json + clips.jsonl into `out_dir`.

    Splits are 90/10 by SHA-1 of clip id; running twice with the same
    manifest produces the same split. This is what lets us re-run the
    eval scripts in Sprint 16 against historical splits.
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
