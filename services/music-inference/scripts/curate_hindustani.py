"""Curate a Hindustani instrumental + vocal corpus for v1.4 Sprint 10.

Hindustani LoRA target style: North Indian classical — khyal, dhrupad,
thumri, ghazal — with tabla / harmonium / sarangi / sitar
accompaniment, raga-driven melodic frames, gat/jor/jhala instrumental
sections. Language landscape is Hindi/Urdu/Bengali/Sanskrit (rare).

Source landscape:
  - Saraga Hindustani (CompMusic, CC-BY-NC-SA).
  - Dunya Hindustani (https://dunya.compmusic.upf.edu/hindustani).
  - Sangeet Natak Akademi archives (PD-India, public-broadcaster
    fair-use §52).
  - Internet Archive: pre-1972 AIR/Doordarshan archives.

CLI mirrors `curate_carnatic.py`; only the language allow-list differs
(hi/bn/sa instead of te/ta/kn/sa) and the license set is otherwise
identical.

References:
- ADR 0030 (v1.4 Sprint 10): MusicGen Indic-style LoRAs.
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

LOG = logging.getLogger("curate_hindustani")

# Hindustani compositions are usually Hindi or Urdu (we group Urdu under
# Hindi at the script level; the dataset stores the script tag per
# clip). Bengali appears via the Rabindra/Tagore overlap. Sanskrit
# appears in dhrupad's Vedic-text adaptations.
ALLOWED_LANGUAGES: frozenset[str] = frozenset({"hi", "bn", "sa"})

ALLOWED_LICENSES: frozenset[str] = frozenset(
    {"pd-india", "pd-us", "cc-by", "cc-by-sa", "cc-by-nc-sa", "fair-use-§52"}
)


def _validate_hindustani(clips: list[SourceClip]) -> None:
    """Reject clips whose language isn't in the Hindustani allow-list,
    then dispatch to the shared per-clip invariant checks."""
    for c in clips:
        if c.language not in ALLOWED_LANGUAGES:
            raise ValueError(
                f"clip {c.id}: language={c.language!r} not in "
                f"Hindustani allow-list {sorted(ALLOWED_LANGUAGES)}"
            )
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
    _validate_hindustani(clips)
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
        description="Curate Hindustani corpus for v1.4 Sprint 10."
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
