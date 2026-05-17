"""Shared LoRA trainer primitives for v1.4 Sprints 8/9.

Both bhavageete (`kannada-light-classical`) and Tamil-folk (`tamil-folk`)
LoRAs use the same recipe — only the corpus path and the style label
differ. Sprint 10 (MusicGen LoRAs) and Sprint 14 (shloka adapter) will
hook into this same shape with slightly different base-model paths.

The dry-run summary builder is the contract pinned by CI; the real
training loop lives behind a NotImplementedError on the operator path
because heartlib + the audiocraft-style trainer pull deps too heavy
for CI.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

LOG = logging.getLogger("lora_trainer")


def build_dry_run_summary(args: argparse.Namespace) -> dict[str, Any]:
    """Validate the corpus exists and return the trainer's config shape.

    Tests pin every field so a drift between the dry-run summary and
    the real trainer's arguments surfaces in CI instead of 18 hours
    into a GPU job. Style-specific entrypoints add their style label
    to the result so the operator dashboards can tell two concurrent
    runs apart.
    """
    corpus = Path(args.corpus)
    summary_json = corpus / "summary.json"
    if not summary_json.exists():
        raise SystemExit(
            f"Corpus at {corpus} is missing summary.json; run "
            f"the matching curate_*.py script first."
        )
    summary = json.loads(summary_json.read_text(encoding="utf-8"))

    out: dict[str, Any] = {
        "style_family": getattr(args, "style_family", None),
        "base_model": args.base_model,
        "ckpt_dir": str(args.ckpt_dir),
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
        "bf16": bool(args.bf16),
        "target_modules": list(args.target_modules),
        "push_to_hub": args.push_to_hub,
        "wandb_off": True,
        "trackio_project": args.trackio_project,
    }
    return out


def add_common_args(parser: argparse.ArgumentParser) -> None:
    """Wire the shared trainer args onto a per-style parser.

    Each per-style script (`train_bhavageete_lora.py`,
    `train_tamil_folk_lora.py`) calls this and then sets its own
    defaults for `--style-family`, `--corpus`, `--output-dir`, and
    `--push-to-hub` to keep the CLI ergonomic.
    """
    parser.add_argument(
        "--base-model",
        default="HeartMuLa/HeartMuLa-OSS-3B",
        help="HF Hub repo id of the base HeartMuLa we're attaching the LoRA to",
    )
    parser.add_argument(
        "--ckpt-dir",
        type=Path,
        help="Local checkpoint dir HeartMuLa was downloaded to "
        "(defaults to $HEARTMULA_CKPT_DIR or /mnt/models/heartmula/ckpt)",
    )
    parser.add_argument("--rank", type=int, default=32)
    parser.add_argument("--alpha", type=int, default=64)
    parser.add_argument("--dropout", type=float, default=0.05)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--grad-accum", type=int, default=2)
    parser.add_argument(
        "--bf16",
        action="store_true",
        default=True,
        help="Mixed-precision bfloat16 (default on; --no-bf16 to opt out)",
    )
    parser.add_argument(
        "--no-bf16",
        dest="bf16",
        action="store_false",
        help="Disable BF16; use FP16 instead",
    )
    parser.add_argument(
        "--target-modules",
        nargs="+",
        default=[
            "q_proj",
            "v_proj",
            "k_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        help="LoRA target modules; LLaMA/Qwen decoder names",
    )
    parser.add_argument(
        "--trackio-project",
        default="neo-fm/lora-tracker",
        help="Trackio project name for logging",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the training config + dataset shape; do not import torch",
    )
    parser.add_argument("--log-level", default="INFO")


def run_or_dry(args: argparse.Namespace) -> int:
    """Common entrypoint: dry-run prints the summary; full-run calls
    into the operator-only real trainer."""
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
    """The DGX-only path. Validates the operator has the heavy deps and
    hands off to the audiocraft-style trainer in a sibling checkout.
    """
    try:
        import torch  # type: ignore[import-not-found]  # noqa: F401
        import peft  # type: ignore[import-not-found]  # noqa: F401
        import heartlib  # type: ignore[import-not-found]  # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            f"ML deps missing: {exc}. Run `uv sync --extra training` on "
            f"the DGX and verify heartlib is installed."
        ) from exc

    cfg = build_dry_run_summary(args)
    LOG.info("training config", extra={"extra_fields": cfg})

    raise NotImplementedError(
        "DGX trainer integration is operator-only at this commit; "
        "see docs/DECISIONS/0028 + 0029 for the runbook."
    )
