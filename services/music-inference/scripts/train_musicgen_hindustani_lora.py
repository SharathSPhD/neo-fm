"""Train the v1.4 Sprint 10 Hindustani LoRA on MusicGen-Medium.

Runs on DGX Spark; HF Hub is download/upload only.
CI exercises `--dry-run`.

Recipe lives in `_musicgen_lora_trainer.py`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from _musicgen_lora_trainer import (
    add_common_args,
    build_dry_run_summary,
    run_or_dry,
)

STYLE_FAMILY = "hindustani"
DEFAULT_HUB_REPO = "neo-fm/musicgen-hindustani-lora-v1"


def _dry_run_summary(args: argparse.Namespace) -> dict[str, object]:
    return build_dry_run_summary(args)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fine-tune a rank-16 LoRA on MusicGen for v1.4 Hindustani."
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        required=True,
        help="Path to the curated corpus dir (output of curate_hindustani.py)",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--style-family",
        default=STYLE_FAMILY,
        help=(
            f"SongDocument style_family this adapter targets (default: "
            f"{STYLE_FAMILY})"
        ),
    )
    parser.add_argument(
        "--push-to-hub",
        default=None,
        help=f"HF Hub repo id to push the adapter to (suggested: {DEFAULT_HUB_REPO})",
    )
    add_common_args(parser)
    args = parser.parse_args()
    return run_or_dry(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
