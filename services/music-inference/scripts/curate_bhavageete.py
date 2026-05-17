"""Curate a bhavageete vocal+accompaniment corpus for v1.4 Sprint 8.

This is the Kannada-light-classical specialisation of the shared
pipeline in `_corpus_pipeline.py`. Only the style-specific knobs live
here; everything else (manifest schema, license validation, summary
emission, deterministic 90/10 split) is shared with the Tamil-folk
pipeline (`curate_tamil_folk.py`, Sprint 9) and the Sanskrit-shloka
pipeline (Sprint 14).

Source landscape — bhavageete:
  - All India Radio Bengaluru — Indian Copyright Act §52(1)(zb)
    fair-use; Internet Archive cleared subsets of Bendre / KSN / GSS /
    Pu Ti Na pre-1972 broadcasts (death-year PD).
  - Saraga Kannada (CompMusic, CC-BY-NC-SA — research-OK).
  - Dunya Carnatic concert clips filtered for Kannada language.
  - Sangeetha Samrajyam YouTube CC commons via `yt-dlp`.

CLI:

    python curate_bhavageete.py \
        --manifest ../../../data/bhavageete-sources.yaml \
        --out ./corpus/bhavageete-v1 \
        --stage validate         # CI default

References:
- ADR 0028 (v1.4 Sprint 8): bhavageete LoRA on HeartMuLa.
- Research-3 §Stage D for the LoRA recipe (rank 32 on GB10).
- AGENTS.md "Compute rule (v1.4+)": GPU work runs on DGX Spark.
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

LOG = logging.getLogger("curate_bhavageete")

# Bhavageete is Kannada light-classical; the corpus is Kannada-only.
EXPECTED_LANGUAGE = "kn"

# Licenses the bhavageete pipeline accepts. AIR archives use fair-use
# §52; Saraga uses CC-BY-NC-SA; YouTube CC commons use plain CC-BY.
ALLOWED_LICENSES: frozenset[str] = frozenset(
    {"pd-india", "pd-us", "cc-by", "cc-by-nc-sa", "fair-use-§52"}
)


def run_dry(manifest_path: Path, out_dir: Path) -> dict[str, Any]:
    """Validate manifest + emit summary without touching audio."""
    clips: list[SourceClip] = load_manifest(manifest_path)
    validate_manifest(
        clips,
        expected_language=EXPECTED_LANGUAGE,
        allowed_licenses=ALLOWED_LICENSES,
    )
    return emit_manifest_summary(clips, out_dir)


def run_full(manifest_path: Path, out_dir: Path, *, stage: str) -> dict[str, Any]:  # pragma: no cover
    """Operator path; lazy-imports yt-dlp, pyloudnorm, WhisperX, etc.

    Not exercised in CI (no GPU, no audio deps). Each stage writes its
    artefacts next to summary.json so the trainer can pick up partial
    state and the operator can resume after a manual review break.
    """
    if stage in ("all", "validate"):
        return run_dry(manifest_path, out_dir)
    raise NotImplementedError(
        f"Stage {stage!r} is operator-driven on DGX. See docs/DECISIONS/0028 "
        f"for the runbook. Use --dry-run to validate the manifest in CI."
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Curate bhavageete corpus for v1.4 Sprint 8."
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
