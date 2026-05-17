"""Train the v1.4 Sprint 8 bhavageete LoRA on HeartMuLa.

Reads the corpus produced by `curate_bhavageete.py` and runs a rank-32
PEFT/LoRA fine-tune on top of the base HeartMuLa weights. **Runs on
DGX Spark.** Per the v1.4 compute rule (AGENTS.md), HuggingFace Hub is
download/upload only.

Recipe lives in `_lora_trainer.py`; this script just sets the style-
specific defaults and the bhavageete-specific HF Hub push target.
CI exercises `--dry-run`.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from _lora_trainer import add_common_args, build_dry_run_summary, run_or_dry

STYLE_FAMILY = "kannada-light-classical"
DEFAULT_HUB_REPO = "neo-fm/heartmula-bhavageete-lora-v1"


def _dry_run_summary(args: argparse.Namespace) -> dict[str, object]:
    """Backwards-compat shim for tests that call `_dry_run_summary`."""
    return build_dry_run_summary(args)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fine-tune a rank-32 LoRA on HeartMuLa for v1.4 bhavageete."
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        required=True,
        help="Path to the curated corpus dir (output of curate_bhavageete.py)",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--style-family",
        default=STYLE_FAMILY,
        help=f"SongDocument style_family this adapter targets (default: {STYLE_FAMILY})",
    )
    parser.add_argument(
        "--push-to-hub",
        default=None,
        help=f"HF Hub repo id to push the adapter to (suggested: {DEFAULT_HUB_REPO})",
    )
    add_common_args(parser)
    args = parser.parse_args()

    if args.ckpt_dir is None:
        args.ckpt_dir = Path(
            os.environ.get("HEARTMULA_CKPT_DIR", "/mnt/models/heartmula/ckpt")
        )
    return run_or_dry(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
