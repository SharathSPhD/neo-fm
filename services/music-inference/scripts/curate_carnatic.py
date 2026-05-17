"""Curate a Carnatic instrumental + vocal corpus for v1.4 Sprint 10.

Carnatic LoRA target style: South Indian classical, raga-driven, with
gamaka-heavy vocal lines, violin/mridangam/ghatam accompaniment, tani
avartanam rhythmic interludes. Language landscape is Telugu/Tamil/
Kannada/Sanskrit; this curator allows the four because Carnatic
compositions cross all four (Tyagaraja: Telugu; Muthuswami Dikshitar:
Sanskrit; Papanasam Sivan: Tamil; Purandara Dasa: Kannada).

Source landscape:
  - Saraga Carnatic (CompMusic, CC-BY-NC-SA — research-OK).
  - Dunya Carnatic (https://dunya.compmusic.upf.edu/carnatic), same
    license, pre-segmented at the kriti level.
  - Internet Archive: AIR Chennai pre-1972 broadcasts (death-year PD
    plus AIR fair-use §52).
  - Sangeetha Samrajyam / Charsur Foundation CC-BY YouTube uploads.

CLI mirrors `curate_bhavageete.py`; only the language allow-list +
license set differ. The dry-run path is what CI exercises; the full
pipeline (yt-dlp + WhisperX + MFA + LLM captioning) is operator-only.

References:
- ADR 0030 (v1.4 Sprint 10): MusicGen Indic-style LoRAs.
- Research-4 §Stage A for Carnatic raga annotation.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

from _corpus_pipeline import (
    SourceClip,
    emit_manifest_summary,
    load_manifest,
    validate_manifest,
)

LOG = logging.getLogger("curate_carnatic")

# Carnatic compositions span four languages; the curator allows any of
# them and the LoRA learns the *style* (gamaka, raga, mridangam), not a
# specific language. The dataset captions still attach the per-clip
# language for retrieval analysis in Sprint 16.
ALLOWED_LANGUAGES: frozenset[str] = frozenset({"te", "ta", "kn", "sa"})

ALLOWED_LICENSES: frozenset[str] = frozenset(
    {"pd-india", "pd-us", "cc-by", "cc-by-sa", "cc-by-nc-sa", "fair-use-§52"}
)


def _validate_carnatic(clips: list[SourceClip]) -> None:
    """Reject clips whose language isn't in the Carnatic allow-list.

    `validate_manifest` only checks a single expected language; we need
    a multi-language allow-list, so we run a pre-check then dispatch to
    a per-clip `validate_manifest` for the shared license + duration +
    URL invariants.
    """
    for c in clips:
        if c.language not in ALLOWED_LANGUAGES:
            raise ValueError(
                f"clip {c.id}: language={c.language!r} not in "
                f"Carnatic allow-list {sorted(ALLOWED_LANGUAGES)}"
            )
    # Single-language argument to validate_manifest is irrelevant once
    # we've pre-checked, so we pass each clip's own language and let
    # the validator only run the license + duration + URL invariants.
    # Easiest is to monkey-loop per language group.
    by_lang: dict[str, list[SourceClip]] = {}
    for c in clips:
        by_lang.setdefault(c.language, []).append(c)
    for lang, group in by_lang.items():
        validate_manifest(
            group,
            expected_language=lang,
            allowed_licenses=ALLOWED_LICENSES,
        )


def run_dry(manifest_path: Path, out_dir: Path) -> dict[str, Any]:
    clips: list[SourceClip] = load_manifest(manifest_path)
    _validate_carnatic(clips)
    return emit_manifest_summary(clips, out_dir)


def run_full(  # pragma: no cover
    manifest_path: Path, out_dir: Path, *, stage: str
) -> dict[str, Any]:
    if stage in ("all", "validate"):
        return run_dry(manifest_path, out_dir)
    raise NotImplementedError(
        f"Stage {stage!r} is operator-driven on DGX. See docs/DECISIONS/0030 "
        f"for the runbook. Use --dry-run to validate the manifest in CI."
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Curate Carnatic corpus for v1.4 Sprint 10."
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--stage",
        choices=[
            "validate",
            "download",
            "segment",
            "vad",
            "align",
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
