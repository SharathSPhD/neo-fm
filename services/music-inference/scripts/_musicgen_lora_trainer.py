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
    """MusicGen LoRA training loop (DGX-only).

    Pipeline:
      1. Load MusicgenForConditionalGeneration + AutoProcessor.
      2. Freeze T5 text encoder and EnCodec audio encoder.
      3. Apply PEFT LoRA to decoder (q/k/v/out_proj in self- and cross-attn).
      4. Iterate corpus: WAV → resample 32 kHz → EnCodec codebook-0 tokens.
         Condition string: "<style> music, raga <raga>, tala <tala>".
      5. Train with HuggingFace Trainer (CrossEntropy on next audio token).
      6. Save LoRA adapter to output_dir / "adapter"; optional push_to_hub.
    """
    try:
        import torch  # type: ignore[import-not-found]
        import peft  # type: ignore[import-not-found]
        import torchaudio  # type: ignore[import-not-found]
        from transformers import (  # type: ignore[import-not-found]
            MusicgenForConditionalGeneration,
            AutoProcessor,
            TrainingArguments,
            Trainer,
        )
    except ImportError as exc:
        raise SystemExit(
            f"ML deps missing: {exc}. Run `uv sync --extra training` on "
            f"the DGX and verify audiocraft + transformers>=4.40 are installed."
        ) from exc

    import json as _json
    from typing import Any as _Any

    cfg = build_dry_run_summary(args)
    LOG.info("training_start", extra={"extra_fields": cfg})

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    corpus_dir = Path(args.corpus)

    # ── 1. Load model + processor ─────────────────────────────────────────
    torch_dtype = torch.bfloat16 if args.bf16 else torch.float16
    LOG.info("loading_model", extra={"extra_fields": {"base_model": args.base_model}})
    model = MusicgenForConditionalGeneration.from_pretrained(
        args.base_model,
        torch_dtype=torch_dtype,
    ).to("cuda")
    processor = AutoProcessor.from_pretrained(args.base_model)

    # ── 2. Freeze T5 text encoder + EnCodec audio encoder ────────────────
    for frozen in (model.text_encoder, model.audio_encoder):
        frozen.eval()
        for p in frozen.parameters():
            p.requires_grad_(False)

    # ── 3. Apply PEFT LoRA to decoder ─────────────────────────────────────
    # T5 text encoder uses q/k/v/o (no _proj suffix) so target_modules
    # q_proj/k_proj/v_proj/out_proj naturally scope to the decoder only.
    lora_cfg = peft.LoraConfig(
        r=args.rank,
        lora_alpha=args.alpha,
        lora_dropout=args.dropout,
        target_modules=list(args.target_modules),
        bias="none",
        task_type=peft.TaskType.SEQ_2_SEQ_LM,
    )
    model = peft.get_peft_model(model, lora_cfg)
    trainable, total = model.get_nb_trainable_parameters()
    LOG.info(
        "peft_applied",
        extra={"extra_fields": {"trainable": trainable, "total": total}},
    )

    # ── 4. Build dataset ──────────────────────────────────────────────────
    summary = _json.loads((corpus_dir / "summary.json").read_text())
    clips_by_id: dict[str, dict[str, _Any]] = {}
    for line in (corpus_dir / "clips.jsonl").read_text().splitlines():
        if line.strip():
            c = _json.loads(line)
            clips_by_id[c["id"]] = c

    # MusicGen's EnCodec operates at 32 kHz; HeartMuLa uses 48 kHz.
    _MG_SR = 32_000

    class _MusicGenDataset(torch.utils.data.Dataset):  # type: ignore[misc]
        def __init__(self, clip_ids: list[str]) -> None:
            self._ids = clip_ids

        def __len__(self) -> int:
            return len(self._ids)

        def __getitem__(self, idx: int) -> dict[str, _Any]:
            cid = self._ids[idx]
            meta = clips_by_id.get(cid, {})
            wav_path = corpus_dir / f"{cid}.wav"
            waveform, sr = torchaudio.load(str(wav_path))
            if sr != _MG_SR:
                waveform = torchaudio.functional.resample(waveform, sr, _MG_SR)
            waveform = waveform.mean(0, keepdim=True)  # mono (1, samples)

            # EnCodec encode → audio_codes (1, num_codebooks, seq_len)
            # We train on codebook 0 only — sufficient for style adaptation.
            with torch.no_grad():
                enc_out = model.audio_encoder.encode(
                    waveform.unsqueeze(0).to("cuda"),
                    bandwidth=6.0,
                )
                audio_codes = enc_out.audio_codes[0, 0].cpu()  # (seq_len,)

            # Conditioning text: human-readable style tag the model can
            # associate with the learned timbral distribution.
            raga = meta.get("raga") or ""
            tala = meta.get("tala") or ""
            style = getattr(args, "style_family", "") or ""
            conditioning = f"{style} music, raga {raga}, tala {tala}".strip(", ")

            text_enc = processor.tokenizer(
                conditioning,
                return_tensors="pt",
                truncation=True,
                max_length=256,
                padding=False,
            )
            return {
                "input_ids": text_enc.input_ids.squeeze(0),
                "attention_mask": text_enc.attention_mask.squeeze(0),
                "labels": audio_codes,
            }

    def _collate(batch: list[dict[str, _Any]]) -> dict[str, _Any]:
        import torch as _t

        input_ids = _t.nn.utils.rnn.pad_sequence(
            [b["input_ids"] for b in batch], batch_first=True, padding_value=0
        )
        attention_mask = _t.nn.utils.rnn.pad_sequence(
            [b["attention_mask"] for b in batch], batch_first=True, padding_value=0
        )
        labels = _t.nn.utils.rnn.pad_sequence(
            [b["labels"] for b in batch], batch_first=True, padding_value=-100
        )
        return {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "labels": labels,
        }

    train_ds = _MusicGenDataset(summary["splits"]["train_clip_ids"])
    eval_ds = _MusicGenDataset(summary["splits"]["eval_clip_ids"])

    # ── 5. Train ──────────────────────────────────────────────────────────
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
        report_to=[],
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        data_collator=_collate,
    )
    trainer.train()

    # ── 6. Save adapter ───────────────────────────────────────────────────
    adapter_path = output_dir / "adapter"
    model.save_pretrained(str(adapter_path))
    LOG.info("adapter_saved", extra={"extra_fields": {"path": str(adapter_path)}})
    if args.push_to_hub:
        model.push_to_hub(args.push_to_hub)
        LOG.info("pushed_to_hub", extra={"extra_fields": {"repo": args.push_to_hub}})
    return 0


__all__ = ["add_common_args", "build_dry_run_summary", "run_or_dry"]
