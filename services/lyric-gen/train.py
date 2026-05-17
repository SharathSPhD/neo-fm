#!/usr/bin/env python3
"""
SFT IndicBART on the lyric-gen corpus, on the DGX Spark (GB10).

Per the v1.4 plan (Sprint 7):
  - Base model: `ai4bharat/IndicBART` (encoder-decoder, MIT, 244 M params,
    multilingual Indic).
  - Recipe: SFT with `transformers.Seq2SeqTrainer`. AdamW 3e-5, 5 epochs,
    effective batch 32 via grad-accum, BF16. ~6-12 GPU-hours on a GB10.
  - Inputs: structured prompts emitted by `scripts/prepare_dataset.py`.
  - Outputs: a LoRA-or-full-FT checkpoint saved to `--output-dir`, ready
    to push to HF Hub as `neo-fm/lyric-gen-indicbart-v1` and load via
    `LYRIC_GEN_BACKEND=indicbart LYRIC_GEN_HF_ADAPTER=neo-fm/...`.

The script is intentionally executable in two modes:
  - **`--dry-run`** (default in CI): import the corpus, print the
    intended Trainer config, exit 0. No torch / transformers import.
    Lets the Sprint 7 promise gate run `uv run python train.py
    --dry-run --dataset data/lyric-gen-corpus` without DGX.
  - **default (no --dry-run)**: actually train. Requires the `training`
    extra (`uv sync --extra training`) — torch, transformers, peft,
    accelerate, sentencepiece, datasets.

Resume behaviour: passing `--output-dir` over an existing checkpoint
resumes from the last `checkpoint-*` directory if one exists. This is
how the operator handles "I lost the SSH session at hour 9" without
restarting the run from scratch.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

SUPPORTED_LORA_TARGETS = ("q_proj", "k_proj", "v_proj", "out_proj")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--dataset",
        type=Path,
        required=True,
        help="Path to a directory containing train.jsonl / eval.jsonl "
        "(produced by scripts/prepare_dataset.py).",
    )
    p.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="Where to save the SFT checkpoint. Resumes if a prior "
        "checkpoint-* directory is found.",
    )
    p.add_argument(
        "--base-model",
        default="ai4bharat/IndicBART",
        help="HF repo id of the base model. Default ai4bharat/IndicBART.",
    )
    p.add_argument("--epochs", type=int, default=5)
    p.add_argument("--lr", type=float, default=3e-5)
    p.add_argument("--batch-size", type=int, default=8)
    p.add_argument("--grad-accum", type=int, default=4)
    p.add_argument("--max-input-tokens", type=int, default=256)
    p.add_argument("--max-target-tokens", type=int, default=256)
    p.add_argument(
        "--bf16",
        action="store_true",
        default=True,
        help="BF16 training (default on, recommended for the GB10).",
    )
    p.add_argument(
        "--no-bf16",
        dest="bf16",
        action="store_false",
        help="Disable BF16 (fall back to FP32; rarely useful).",
    )
    p.add_argument(
        "--lora-rank",
        type=int,
        default=0,
        help=(
            "If > 0, train a LoRA of this rank instead of full FT. "
            "Default 0 = full FT, recommended for IndicBART's 244 M "
            "parameter count which fits easily in BF16 on the GB10."
        ),
    )
    p.add_argument(
        "--logging-steps",
        type=int,
        default=50,
        help="How often to log loss to stdout / trackio.",
    )
    p.add_argument(
        "--save-steps",
        type=int,
        default=500,
        help="Checkpoint frequency. Lower if you expect interruptions.",
    )
    p.add_argument(
        "--push-to-hub",
        default=None,
        help=(
            "If set, push the final checkpoint to this HF Hub repo. "
            "Recommended target: neo-fm/lyric-gen-indicbart-v1."
        ),
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate dataset paths and config without importing torch.",
    )
    return p.parse_args()


def _validate_dataset(dataset_dir: Path) -> dict[str, int]:
    train_path = dataset_dir / "train.jsonl"
    eval_path = dataset_dir / "eval.jsonl"
    if not train_path.exists():
        raise SystemExit(f"missing {train_path}; run scripts/prepare_dataset.py first")
    if not eval_path.exists():
        raise SystemExit(f"missing {eval_path}; run scripts/prepare_dataset.py first")

    def _count(p: Path) -> int:
        with p.open("r", encoding="utf-8") as f:
            return sum(1 for _ in f)

    return {"train": _count(train_path), "eval": _count(eval_path)}


def _find_last_checkpoint(output_dir: Path) -> Path | None:
    if not output_dir.exists():
        return None
    candidates = sorted(
        (d for d in output_dir.iterdir() if d.is_dir() and d.name.startswith("checkpoint-")),
        key=lambda d: int(d.name.split("-")[-1]) if d.name.split("-")[-1].isdigit() else 0,
    )
    return candidates[-1] if candidates else None


def _maybe_train(args: argparse.Namespace) -> None:
    """Real training path. Lazy-imports torch/transformers/peft."""
    # Imports kept inside the function so `--dry-run` works in CI
    # without the training extra installed.
    import torch  # type: ignore[import-not-found]
    from datasets import load_dataset  # type: ignore[import-not-found]
    from transformers import (  # type: ignore[import-not-found]
        AutoModelForSeq2SeqLM,
        AutoTokenizer,
        DataCollatorForSeq2Seq,
        Seq2SeqTrainer,
        Seq2SeqTrainingArguments,
    )

    tok = AutoTokenizer.from_pretrained(args.base_model, use_fast=False)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        args.base_model,
        torch_dtype=torch.bfloat16 if args.bf16 else torch.float32,
    )

    if args.lora_rank > 0:
        from peft import LoraConfig, get_peft_model  # type: ignore[import-not-found]

        lora_cfg = LoraConfig(
            r=args.lora_rank,
            lora_alpha=args.lora_rank * 2,
            target_modules=list(SUPPORTED_LORA_TARGETS),
            lora_dropout=0.05,
            bias="none",
            task_type="SEQ_2_SEQ_LM",
        )
        model = get_peft_model(model, lora_cfg)
        if hasattr(model, "print_trainable_parameters"):
            model.print_trainable_parameters()

    train_files = {
        "train": str(args.dataset / "train.jsonl"),
        "validation": str(args.dataset / "eval.jsonl"),
    }
    ds = load_dataset("json", data_files=train_files)

    def _tokenize(batch: dict[str, list[str]]) -> dict[str, Any]:
        model_inputs = tok(
            batch["prompt"],
            max_length=args.max_input_tokens,
            truncation=True,
        )
        labels = tok(
            text_target=batch["target"],
            max_length=args.max_target_tokens,
            truncation=True,
        )
        model_inputs["labels"] = labels["input_ids"]
        return model_inputs

    tokenised = ds.map(_tokenize, batched=True, remove_columns=ds["train"].column_names)

    collator = DataCollatorForSeq2Seq(tokenizer=tok, model=model, padding="longest")

    targs = Seq2SeqTrainingArguments(
        output_dir=str(args.output_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        bf16=args.bf16,
        fp16=False,
        logging_steps=args.logging_steps,
        save_steps=args.save_steps,
        eval_strategy="steps",
        eval_steps=args.save_steps,
        save_total_limit=3,
        predict_with_generate=True,
        report_to=["none"],
        push_to_hub=bool(args.push_to_hub),
        hub_model_id=args.push_to_hub,
        save_safetensors=True,
    )

    trainer = Seq2SeqTrainer(
        model=model,
        args=targs,
        train_dataset=tokenised["train"],
        eval_dataset=tokenised["validation"],
        tokenizer=tok,
        data_collator=collator,
    )

    resume_from = _find_last_checkpoint(args.output_dir)
    if resume_from is not None:
        trainer.train(resume_from_checkpoint=str(resume_from))
    else:
        trainer.train()
    trainer.save_model(str(args.output_dir))
    if args.push_to_hub:
        trainer.push_to_hub()


def main() -> int:
    args = _parse_args()
    counts = _validate_dataset(args.dataset)
    plan = {
        "base_model": args.base_model,
        "dataset": str(args.dataset),
        "output_dir": str(args.output_dir),
        "epochs": args.epochs,
        "lr": args.lr,
        "batch_size": args.batch_size,
        "grad_accum": args.grad_accum,
        "effective_batch": args.batch_size * args.grad_accum,
        "lora_rank": args.lora_rank,
        "bf16": args.bf16,
        "train_examples": counts["train"],
        "eval_examples": counts["eval"],
        "max_input_tokens": args.max_input_tokens,
        "max_target_tokens": args.max_target_tokens,
        "push_to_hub": args.push_to_hub,
    }
    print(json.dumps(plan, indent=2, sort_keys=True))

    if args.dry_run:
        return 0

    if "DGX_SPARK_HOST" not in os.environ:
        sys.stderr.write(
            "WARNING: DGX_SPARK_HOST not set in env. Per the v1.4 compute "
            "rule, training runs only on the DGX Spark (GB10). Continuing "
            "anyway, but if you're not on the DGX you should --dry-run.\n"
        )

    _maybe_train(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
