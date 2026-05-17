"""Train the v1.4 Sprint 9 Tamil-folk LoRA on HeartMuLa.

Reads the corpus produced by `curate_tamil_folk.py` and runs a rank-32
PEFT/LoRA fine-tune on top of the base HeartMuLa weights. **Runs on
DGX Spark.** Per the v1.4 compute rule (AGENTS.md), HuggingFace Hub is
download/upload only.

The recipe is identical to Sprint 8's bhavageete LoRA (`_lora_trainer.py`);
only the style label and the HF Hub push target change. Corpus size
target is 30 min - 2 hours (vs bhavageete's 30 min - 4 hours) because
the Tamil-folk source pool is smaller and the operator's curation
budget is tighter — the LoRA capacity at rank 32 stays oversized for
the dataset so this is fine.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from _lora_trainer import add_common_args, build_dry_run_summary, run_or_dry  # noqa: F401

STYLE_FAMILY = "tamil-folk"
DEFAULT_HUB_REPO = "neo-fm/heartmula-tamil-folk-lora-v1"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fine-tune a rank-32 LoRA on HeartMuLa for v1.4 Tamil-folk."
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        required=True,
        help="Path to the curated corpus dir (output of curate_tamil_folk.py)",
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
