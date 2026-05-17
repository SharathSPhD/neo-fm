"""Train the v1.4 Sprint 11 short-clip LoRA on Stable Audio Open.

Reads the corpus produced by `curate_stems.py` and runs a rank-16
PEFT/LoRA fine-tune on the SAO diffusion transformer. Runs on DGX
Spark; HF Hub is download/upload only.

CI exercises `--dry-run`. The real training path raises
NotImplementedError outside DGX (no diffusers/SAO in CI).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

LOG = logging.getLogger("train_stems_lora")

STYLE_ADAPTERS = "stems"
DEFAULT_HUB_REPO = "neo-fm/stable-audio-open-stems-lora-v1"


def build_dry_run_summary(args: argparse.Namespace) -> dict[str, Any]:
    corpus = Path(args.corpus)
    summary_json = corpus / "summary.json"
    if not summary_json.exists():
        raise SystemExit(
            f"Corpus at {corpus} is missing summary.json; run "
            f"curate_stems.py first."
        )
    summary = json.loads(summary_json.read_text(encoding="utf-8"))

    return {
        "engine": "stable-audio-open",
        "adapter_kind": "short-clip-stems-v1",
        "base_model": args.base_model,
        "corpus": str(corpus),
        "output_dir": str(args.output_dir),
        "train_clip_count": len(summary["splits"]["train_clip_ids"]),
        "eval_clip_count": len(summary["splits"]["eval_clip_ids"]),
        "total_hours": summary["total_hours"],
        "rank": args.rank,
        "alpha": args.alpha,
        "dropout": args.dropout,
        "lr": args.lr,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "grad_accum": args.grad_accum,
        "effective_batch": args.batch_size * args.grad_accum,
        "fp16": bool(args.fp16),
        "target_modules": list(args.target_modules),
        "push_to_hub": args.push_to_hub,
        "trackio_project": args.trackio_project,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fine-tune a rank-16 LoRA on Stable Audio Open for v1.4 stems."
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        required=True,
        help="Path to the curated corpus dir (output of curate_stems.py)",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--base-model",
        default="stabilityai/stable-audio-open-1.0",
    )
    parser.add_argument("--rank", type=int, default=16)
    parser.add_argument("--alpha", type=int, default=32)
    parser.add_argument("--dropout", type=float, default=0.05)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--grad-accum", type=int, default=4)
    # SAO trains in FP16 — its DiT was published at that precision.
    parser.add_argument("--fp16", action="store_true", default=True)
    parser.add_argument("--no-fp16", dest="fp16", action="store_false")
    parser.add_argument(
        "--target-modules",
        nargs="+",
        default=[
            "to_q",
            "to_k",
            "to_v",
            "to_out",
        ],
        help="LoRA target modules; SAO DiT attention block names",
    )
    parser.add_argument(
        "--push-to-hub",
        default=None,
        help=f"HF Hub repo id to push the adapter to (suggested: {DEFAULT_HUB_REPO})",
    )
    parser.add_argument(
        "--trackio-project",
        default="neo-fm/stems-lora",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--log-level", default="INFO")

    args = parser.parse_args()
    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    if args.dry_run:
        summary = build_dry_run_summary(args)
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0
    return _real_train(args)


def _real_train(args: argparse.Namespace) -> int:  # pragma: no cover
    try:
        import peft  # type: ignore[import-not-found]  # noqa: F401
        import stable_audio_tools  # type: ignore[import-not-found]  # noqa: F401
        import torch  # type: ignore[import-not-found]  # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            f"ML deps missing: {exc}. Run `uv sync --extra training` on "
            f"the DGX and verify stable-audio-tools is installed."
        ) from exc

    cfg = build_dry_run_summary(args)
    LOG.info("training config", extra={"extra_fields": cfg})
    raise NotImplementedError(
        "DGX trainer integration is operator-only at this commit; "
        "see docs/DECISIONS/0031 for the runbook."
    )


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
