"""Shared LoRA trainer primitives for v1.4 Sprint 10 (MusicGen).

Mirrors `_lora_trainer.py` (HeartMuLa) but with MusicGen-specific
defaults:

  - Base model: `facebook/musicgen-medium` (1.5 B params, MIT license).
  - LoRA targets: MusicGen's decoder LM uses `q_proj/k_proj/v_proj/
    out_proj` (HuggingFace MusicgenForConditionalGeneration layout —
    see `transformers/models/musicgen/modeling_musicgen.py`).
  - Trainer entrypoint: a thin wrapper around audiocraft + peft. The
    CI-runnable surface is the `--dry-run` summary; the real training
    loop NotImplementedErrors and points operators at the runbook.
  - Rank/alpha defaults (16/32) are smaller than HeartMuLa's (32/64)
    because MusicGen-Medium is roughly half the parameter count; we
    aim for the same effective adapter capacity (≈3% of params).

Carnatic + Hindustani LoRAs (Sprint 10) use the same recipe, only
differing in corpus and style label. Sprint 16's A/B router uses
`style_family` to pick the adapter.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

LOG = logging.getLogger("musicgen_lora_trainer")


def build_dry_run_summary(args: argparse.Namespace) -> dict[str, Any]:
    """Return the config shape the operator's MusicGen trainer will see.

    Identical contract to `_lora_trainer.build_dry_run_summary` so the
    same dashboards and CI assertions work across HeartMuLa and
    MusicGen LoRAs.
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
        "engine": "musicgen",
        "style_family": getattr(args, "style_family", None),
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
        "bf16": bool(args.bf16),
        "target_modules": list(args.target_modules),
        "push_to_hub": args.push_to_hub,
        "trackio_project": args.trackio_project,
    }
    return out


def add_common_args(parser: argparse.ArgumentParser) -> None:
    """Wire shared MusicGen-LoRA args onto a per-style parser."""
    parser.add_argument(
        "--base-model",
        default="facebook/musicgen-medium",
        help="HF Hub repo id of the base MusicGen we're attaching the LoRA to",
    )
    # MusicGen-Medium is ~half the params of HeartMuLa-3B, so rank/alpha
    # halve as well; same effective % of params.
    parser.add_argument("--rank", type=int, default=16)
    parser.add_argument("--alpha", type=int, default=32)
    parser.add_argument("--dropout", type=float, default=0.05)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--grad-accum", type=int, default=4)
    parser.add_argument(
        "--bf16",
        action="store_true",
        default=True,
    )
    parser.add_argument("--no-bf16", dest="bf16", action="store_false")
    parser.add_argument(
        "--target-modules",
        nargs="+",
        default=["q_proj", "k_proj", "v_proj", "out_proj"],
        help="LoRA target modules; MusicGen decoder names",
    )
    parser.add_argument(
        "--trackio-project",
        default="neo-fm/musicgen-lora",
        help="Trackio project name for logging",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the training config + dataset shape; do not import torch",
    )
    parser.add_argument("--log-level", default="INFO")


def run_or_dry(args: argparse.Namespace) -> int:
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
    """DGX-only path. Refuses to run without audiocraft + peft."""
    try:
        import audiocraft  # type: ignore[import-not-found]  # noqa: F401
        import peft  # type: ignore[import-not-found]  # noqa: F401
        import torch  # type: ignore[import-not-found]  # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            f"ML deps missing: {exc}. Run `uv sync --extra training` on "
            f"the DGX and verify audiocraft is installed."
        ) from exc

    cfg = build_dry_run_summary(args)
    LOG.info("training config", extra={"extra_fields": cfg})
    raise NotImplementedError(
        "DGX trainer integration is operator-only at this commit; "
        "see docs/DECISIONS/0030 for the runbook."
    )


__all__ = ["add_common_args", "build_dry_run_summary", "run_or_dry"]
