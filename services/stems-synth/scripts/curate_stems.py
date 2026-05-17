"""Curate a short-clip stems corpus for v1.4 Sprint 11.

The stems LoRA targets the eight presets listed in
`app/model.STEM_PRESETS`. Each preset trains on a subset of
percussion / drone / interlude stems from:

  - Saraga Carnatic + Hindustani (CC-BY-NC-SA): isolated mridangam,
    tabla, tanpura stems.
  - MUSDB18-Indic adjacents (`indic-stems-cc` archive): parai,
    nadaswaram, harmonium.
  - AIR fair-use clips containing identifiable single-instrument
    interludes.
  - Pre-1972 PD broadcasts where the percussion break is isolated.

This curator mirrors `services/music-inference/scripts/curate_*.py`
but with a wider instrument allow-list and a much shorter clip cap
(8s instead of 30s, because Stable Audio Open trains best on short
windows).

CI exercises the `--dry-run` validate-and-summarise path; the heavy
audio-touching stages (download, isolate-stems, normalise) live in
the operator runbook.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

# Reuse the music-inference corpus pipeline machinery. Tests add the
# music-inference scripts/ dir to sys.path; the operator runbook also
# does this. Keeps the contract for manifest format identical across
# Sprints 8/9/10/11.
HERE = Path(__file__).resolve().parent
MUSIC_SCRIPTS = HERE.parent.parent / "music-inference" / "scripts"
sys.path.insert(0, str(MUSIC_SCRIPTS))

from _corpus_pipeline import (  # noqa: E402
    SourceClip,
    emit_manifest_summary,
    load_manifest,
    validate_manifest,
)

LOG = logging.getLogger("curate_stems")

# Stems are very short by construction; 8s is the SAO sweet spot.
MAX_CLIP_SECONDS = 8.0

# All non-English Indic languages are valid here because we annotate
# stems by *instrument*, not language. We still reject `en` so a stray
# Western-pop loop doesn't bias the LoRA.
ALLOWED_LANGUAGES: frozenset[str] = frozenset(
    {"hi", "kn", "ta", "te", "bn", "sa"}
)

# Same license set as Carnatic / Hindustani curators (Sprint 10).
ALLOWED_LICENSES: frozenset[str] = frozenset(
    {"pd-india", "pd-us", "cc-by", "cc-by-sa", "cc-by-nc-sa", "fair-use-§52"}
)


def _validate_stems(clips: list[SourceClip]) -> None:
    """Pre-check the language allow-list, then dispatch to per-language
    groups for the shared license + duration + URL invariants. We
    override the duration cap to 8s for stems."""
    for c in clips:
        if c.language not in ALLOWED_LANGUAGES:
            raise ValueError(
                f"clip {c.id}: language={c.language!r} not in stems "
                f"allow-list {sorted(ALLOWED_LANGUAGES)}"
            )
    by_lang: dict[str, list[SourceClip]] = {}
    for c in clips:
        by_lang.setdefault(c.language, []).append(c)
    for lang, group in by_lang.items():
        validate_manifest(
            group,
            expected_language=lang,
            allowed_licenses=ALLOWED_LICENSES,
            max_clip_seconds=MAX_CLIP_SECONDS,
        )


def run_dry(manifest_path: Path, out_dir: Path) -> dict[str, Any]:
    clips: list[SourceClip] = load_manifest(manifest_path)
    _validate_stems(clips)
    return emit_manifest_summary(clips, out_dir)


def run_full(  # pragma: no cover
    manifest_path: Path, out_dir: Path, *, stage: str
) -> dict[str, Any]:
    if stage in ("all", "validate"):
        return run_dry(manifest_path, out_dir)
    raise NotImplementedError(
        f"Stage {stage!r} is operator-driven on DGX. See docs/DECISIONS/0031 "
        f"for the runbook. Use --dry-run to validate the manifest in CI."
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Curate stems corpus for v1.4 Sprint 11."
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--stage",
        choices=[
            "validate",
            "download",
            "isolate-stems",
            "normalise",
            "caption",
            "export",
            "all",
        ],
        default="validate",
    )
    parser.add_argument("--dry-run", action="store_true")
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
