"""Train the v1.4 Sprint 8 bhavageete LoRA on HeartMuLa.

Reads the corpus produced by `curate_bhavageete.py` and runs a rank-32
PEFT/LoRA fine-tune on top of the base HeartMuLa weights. **Runs on
DGX Spark.** Per the v1.4 compute rule (AGENTS.md), HuggingFace Hub is
download/upload only; no Jobs / RunPod / Vast.

Recipe (per research-3 Stage D, scaled for GB10):

  - Adapter rank 32, alpha 64, dropout 0.05, target modules ["q_proj",
    "v_proj", "k_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
    (the standard LLaMA/Qwen LoRA target set; heartlib's `mula` is a
    LLaMA-style decoder).
  - Optimizer AdamW, lr 1e-4, weight_decay 0.01, cosine schedule.
  - Batch 16, grad-accum 2 (effective 32), BF16 mixed precision.
  - 5 epochs.
  - Trackio logging to a private HF Space (`neo-fm/lora-tracker`).

The trainer here is intentionally a thin wrapper around peft + the
audiocraft-style trainer in `chavinlo/musicgen_trainer`. We don't ship
that trainer in-tree; the operator pulls it as a sibling and invokes
this script with `--musicgen-trainer-root /path/to/checkout`.

CI exercises `--dry-run` so the harness wiring is testable without
torch / peft / heartlib.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

LOG = logging.getLogger("train_bhavageete_lora")


def _dry_run_summary(args: argparse.Namespace) -> dict[str, Any]:
    """Return the configuration shape the real trainer would receive.

    Pinned by `tests/test_train_bhavageete_lora.py` so a config drift
    surfaces in a deterministic test rather than at the bottom of a
    24-hour GPU job.
    """
    corpus = Path(args.corpus)
    summary_json = corpus / "summary.json"
    if not summary_json.exists():
        raise SystemExit(
            f"Corpus at {corpus} is missing summary.json; run "
            f"curate_bhavageete.py first."
        )
    summary = json.loads(summary_json.read_text(encoding="utf-8"))

    return {
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


def _maybe_train(args: argparse.Namespace) -> int:  # pragma: no cover
    """Real training path. Refuses to run if heartlib/peft are missing
    so a misconfigured env doesn't pretend to succeed."""
    try:
        import torch  # type: ignore[import-not-found]
        from peft import LoraConfig, get_peft_model  # type: ignore[import-not-found]
        from heartlib import HeartMuLaGenPipeline  # type: ignore[import-not-found]
    except ImportError as exc:
        raise SystemExit(
            f"ML deps missing: {exc}. Run `uv sync --extra training` and "
            f"verify heartlib is installed on the DGX."
        ) from exc

    cfg = _dry_run_summary(args)
    LOG.info("training config", extra={"extra_fields": cfg})

    pipe = HeartMuLaGenPipeline.from_pretrained(
        str(args.ckpt_dir),
        device={"mula": torch.device("cuda"), "codec": torch.device("cuda")},
        dtype={
            "mula": torch.bfloat16 if args.bf16 else torch.float16,
            "codec": torch.float32,
        },
        version="3B",
    )
    inner = pipe.mula

    lora_cfg = LoraConfig(
        r=args.rank,
        lora_alpha=args.alpha,
        lora_dropout=args.dropout,
        target_modules=list(args.target_modules),
        bias="none",
        task_type="CAUSAL_LM",
    )
    inner_lora = get_peft_model(inner, lora_cfg)
    pipe.mula = inner_lora

    # Hand off to the audiocraft-style training loop. The actual loop
    # lives in chavinlo/musicgen_trainer (vendored as a sibling on the
    # DGX); we invoke it as a subprocess so its trainer-specific
    # dependencies don't bleed into this module. Spec for the call is
    # in docs/DECISIONS/0028.
    raise NotImplementedError(
        "DGX trainer integration is operator-only at this commit; "
        "see docs/DECISIONS/0028 for the runbook."
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fine-tune a rank-32 LoRA on HeartMuLa for v1.4 bhavageete."
    )
    parser.add_argument(
        "--base-model",
        default="HeartMuLa/HeartMuLa-OSS-3B",
        help="HF Hub repo id of the base HeartMuLa we're attaching the LoRA to",
    )
    parser.add_argument(
        "--ckpt-dir",
        type=Path,
        default=Path(os.environ.get("HEARTMULA_CKPT_DIR", "/mnt/models/heartmula/ckpt")),
        help="Local checkpoint dir HeartMuLa was downloaded to",
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        required=True,
        help="Path to the curated corpus directory (output of curate_bhavageete.py)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="Where to write the LoRA adapter + trainer state",
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
        help="Mixed-precision bfloat16 (default on; pass --no-bf16 to opt out)",
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
        help="LoRA target modules; matches the LLaMA/Qwen decoder layout",
    )
    parser.add_argument(
        "--push-to-hub",
        default=None,
        help="HF Hub repo id to push the adapter to after training (no push if omitted)",
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
    args = parser.parse_args()

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    if args.dry_run:
        summary = _dry_run_summary(args)
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0
    return _maybe_train(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
