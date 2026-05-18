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
    """HeartMuLa LoRA training loop (DGX-only).

    Pipeline:
      1. Load HeartMuLaGenPipeline from heartlib.
      2. Apply PEFT LoRA to pipeline.mula (the inner causal LM).
      3. Iterate over corpus clips: WAV → codec tokens → conditioning text.
      4. Train with HuggingFace Trainer (CrossEntropy on next audio token).
      5. Save the LoRA adapter to output_dir / "adapter".
    """
    try:
        import torch  # type: ignore[import-not-found]
        import peft  # type: ignore[import-not-found]
        from heartlib import HeartMuLaGenPipeline  # type: ignore[import-not-found]
        from transformers import TrainingArguments, Trainer  # type: ignore[import-not-found]
    except ImportError as exc:
        raise SystemExit(
            f"ML deps missing: {exc}. Run `uv sync --extra training` on "
            f"the DGX and verify heartlib is installed."
        ) from exc

    cfg = build_dry_run_summary(args)
    LOG.info("training_start", extra={"extra_fields": cfg})

    ckpt_dir = Path(args.ckpt_dir) if args.ckpt_dir else Path(
        __import__("os").environ.get("HEARTMULA_CKPT_DIR", "/mnt/models/heartmula/ckpt")
    )
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    corpus_dir = Path(args.corpus)

    # ── 1. Load pipeline ──────────────────────────────────────────────────
    torch_dtype = torch.bfloat16 if args.bf16 else torch.float16
    LOG.info("loading_pipeline", extra={"extra_fields": {"ckpt_dir": str(ckpt_dir)}})
    pipe = HeartMuLaGenPipeline.from_pretrained(
        str(ckpt_dir),
        device={"mula": torch.device("cuda"), "codec": torch.device("cuda")},
        dtype={"mula": torch_dtype, "codec": torch.float32},
    )
    pipe.codec.eval()
    for p in pipe.codec.parameters():
        p.requires_grad_(False)

    # ── 2. Apply PEFT LoRA to pipeline.mula ──────────────────────────────
    lora_cfg = peft.LoraConfig(
        r=args.rank,
        lora_alpha=args.alpha,
        lora_dropout=args.dropout,
        target_modules=list(args.target_modules),
        bias="none",
        task_type=peft.TaskType.CAUSAL_LM,
    )
    pipe.mula = peft.get_peft_model(pipe.mula, lora_cfg)
    trainable, total = pipe.mula.get_nb_trainable_parameters()
    LOG.info(
        "peft_applied",
        extra={"extra_fields": {"trainable": trainable, "total": total}},
    )

    # ── 3. Build dataset ─────────────────────────────────────────────────
    import json as _json
    import torchaudio  # type: ignore[import-not-found]

    summary = _json.loads((corpus_dir / "summary.json").read_text())
    clips_by_id: dict[str, dict[str, Any]] = {}
    for line in (corpus_dir / "clips.jsonl").read_text().splitlines():
        if line.strip():
            c = _json.loads(line)
            clips_by_id[c["id"]] = c

    class _LoraDataset(torch.utils.data.Dataset):  # type: ignore[misc]
        def __init__(self, clip_ids: list[str]) -> None:
            self._ids = clip_ids

        def __len__(self) -> int:
            return len(self._ids)

        def __getitem__(self, idx: int) -> dict[str, Any]:
            cid = self._ids[idx]
            meta = clips_by_id.get(cid, {})
            wav_path = corpus_dir / f"{cid}.wav"
            waveform, sr = torchaudio.load(str(wav_path))
            if sr != 48000:
                waveform = torchaudio.functional.resample(waveform, sr, 48000)
            waveform = waveform.mean(0, keepdim=True)  # mono
            # Encode via codec → discrete tokens
            with torch.no_grad():
                tokens = pipe.codec.encode(waveform.unsqueeze(0).to("cuda"))[0]
            # Build conditioning string from metadata
            raga = meta.get("raga") or ""
            tala = meta.get("tala") or ""
            lyrics = meta.get("lyrics_snippet") or ""
            style = getattr(args, "style_family", "") or ""
            conditioning = f"[style:{style}][raga:{raga}][tala:{tala}]{lyrics}"
            # Tokenize conditioning via pipeline's text tokenizer
            cond_ids = pipe.mula.tokenizer(conditioning, return_tensors="pt").input_ids
            return {"input_ids": cond_ids.squeeze(0), "audio_tokens": tokens}

    def _collate(batch: list[dict[str, Any]]) -> dict[str, Any]:
        import torch as _torch
        input_ids = _torch.nn.utils.rnn.pad_sequence(
            [b["input_ids"] for b in batch], batch_first=True, padding_value=0
        )
        audio_tokens = _torch.nn.utils.rnn.pad_sequence(
            [b["audio_tokens"].flatten() for b in batch], batch_first=True, padding_value=-100
        )
        labels = audio_tokens.clone()
        labels[labels == -100] = -100
        return {"input_ids": input_ids, "labels": labels}

    train_ds = _LoraDataset(summary["splits"]["train_clip_ids"])
    eval_ds = _LoraDataset(summary["splits"]["eval_clip_ids"])

    # ── 4. Train ─────────────────────────────────────────────────────────
    training_args = TrainingArguments(
        output_dir=str(output_dir / "checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=max(1, args.batch_size // 2),
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        bf16=args.bf16,
        fp16=(not args.bf16),
        evaluation_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=2,
        load_best_model_at_end=True,
        logging_steps=25,
        dataloader_num_workers=2,
        report_to=([] if args.wandb_off else ["wandb"]),
    )
    trainer = Trainer(
        model=pipe.mula,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        data_collator=_collate,
    )
    trainer.train()

    # ── 5. Save adapter ──────────────────────────────────────────────────
    adapter_path = output_dir / "adapter"
    pipe.mula.save_pretrained(str(adapter_path))
    LOG.info("adapter_saved", extra={"extra_fields": {"path": str(adapter_path)}})
    if args.push_to_hub:
        pipe.mula.push_to_hub(args.push_to_hub)
        LOG.info("pushed_to_hub", extra={"extra_fields": {"repo": args.push_to_hub}})
    return 0
