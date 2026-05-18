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
    """Fine-tune a rank-16 LoRA on Stable Audio Open's DiT.

    Pipeline:
      1. Load SAO model + VAE + CLAP from HF Hub (frozen).
      2. Apply PEFT LoRA to the DiT attention projections.
      3. Build dataset from curated stems corpus (WAV → VAE latents).
      4. Train with DDPM denoising loss (predict noise, MSE).
      5. Save LoRA adapter to --output-dir; optionally push to Hub.
    """
    try:
        import torch  # noqa: PLC0415
        import torchaudio  # type: ignore[import-not-found]  # noqa: PLC0415
        import peft  # type: ignore[import-not-found]  # noqa: PLC0415
        from diffusers import StableAudioPipeline  # type: ignore[import-not-found]  # noqa: PLC0415
        from diffusers.training_utils import compute_snr  # type: ignore[import-not-found]  # noqa: PLC0415
        import torch.nn.functional as F  # noqa: PLC0415
    except ImportError as exc:
        raise SystemExit(
            f"ML deps missing: {exc}. Run `uv sync --extra training` on "
            f"the DGX and verify stable-audio-tools + diffusers are installed."
        ) from exc

    corpus = Path(args.corpus)
    summary = json.loads((corpus / "summary.json").read_text(encoding="utf-8"))
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dtype = torch.float16 if args.fp16 else torch.float32
    LOG.info("device=%s dtype=%s", device, dtype)

    # 1. Load SAO pipeline (VAE + scheduler + text encoders + DiT).
    LOG.info("loading StableAudioPipeline from %s …", args.base_model)
    pipe = StableAudioPipeline.from_pretrained(args.base_model, torch_dtype=dtype)
    pipe = pipe.to(device)
    # Freeze everything; only the LoRA params will train.
    for p in pipe.transformer.parameters():
        p.requires_grad_(False)
    for p in pipe.vae.parameters():
        p.requires_grad_(False)

    # 2. Apply PEFT LoRA to the DiT transformer attention projections.
    lora_cfg = peft.LoraConfig(
        r=args.rank,
        lora_alpha=args.alpha,
        lora_dropout=args.dropout,
        target_modules=list(args.target_modules),
        task_type=peft.TaskType.FEATURE_EXTRACTION,
    )
    pipe.transformer = peft.get_peft_model(pipe.transformer, lora_cfg)
    trainable = sum(p.numel() for p in pipe.transformer.parameters() if p.requires_grad)
    LOG.info("LoRA trainable params: %d", trainable)

    # 3. Build clip list from corpus splits.
    train_ids: set[str] = set(summary["splits"]["train_clip_ids"])
    clip_dir = corpus / "clips"
    clip_files = [
        clip_dir / f"{cid}.wav"
        for cid in train_ids
        if (clip_dir / f"{cid}.wav").exists()
    ]
    if not clip_files:
        raise SystemExit(f"No WAV clips found in {clip_dir}; run curate_stems.py first.")
    LOG.info("training on %d clips", len(clip_files))

    # 4. Training loop: encode audio to VAE latents, add noise, predict noise.
    optimizer = torch.optim.AdamW(
        [p for p in pipe.transformer.parameters() if p.requires_grad],
        lr=args.lr,
    )
    scheduler = pipe.scheduler
    scheduler.set_timesteps(1000)

    SAO_SR = 44100  # Stable Audio Open native sample rate
    pipe.transformer.train()

    global_step = 0
    for epoch in range(args.epochs):
        epoch_loss = 0.0
        n_batches = 0
        batch: list[Any] = []
        for clip_path in clip_files:
            waveform, sr = torchaudio.load(str(clip_path))
            if sr != SAO_SR:
                waveform = torchaudio.functional.resample(waveform, sr, SAO_SR)
            # Mono, pad/trim to 47 seconds (SAO default).
            if waveform.shape[0] > 1:
                waveform = waveform.mean(0, keepdim=True)
            target_len = SAO_SR * 47
            if waveform.shape[-1] < target_len:
                waveform = F.pad(waveform, (0, target_len - waveform.shape[-1]))
            else:
                waveform = waveform[..., :target_len]
            batch.append(waveform)

            if len(batch) >= args.batch_size:
                batch_tensor = torch.stack(batch).to(device, dtype=dtype)
                batch = []
                # Encode with VAE.
                with torch.no_grad():
                    latents = pipe.vae.encode(batch_tensor).latent_dist.sample()
                    latents = latents * pipe.vae.config.scaling_factor

                # Sample noise + timestep.
                noise = torch.randn_like(latents)
                bsz = latents.shape[0]
                timesteps = torch.randint(0, 1000, (bsz,), device=device).long()
                noisy_latents = scheduler.add_noise(latents, noise, timesteps)

                # Null conditioning (unconditional fine-tune on stems).
                encoder_hidden_states = torch.zeros(
                    bsz, 1, pipe.transformer.config.cross_attention_dim,
                    device=device, dtype=dtype,
                )

                # Predict noise.
                noise_pred = pipe.transformer(
                    noisy_latents,
                    timestep=timesteps,
                    encoder_hidden_states=encoder_hidden_states,
                ).sample

                # SNR-weighted MSE loss.
                snr = compute_snr(scheduler, timesteps)
                mse_loss_weights = torch.stack(
                    [snr, 5.0 * torch.ones_like(snr)], dim=1
                ).min(dim=1)[0] / snr
                loss = F.mse_loss(noise_pred.float(), noise.float(), reduction="none")
                loss = (loss.mean(dim=list(range(1, len(loss.shape)))) * mse_loss_weights).mean()

                optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(pipe.transformer.parameters(), 1.0)
                if (n_batches + 1) % args.grad_accum == 0:
                    optimizer.step()
                    optimizer.zero_grad()

                epoch_loss += loss.item()
                n_batches += 1
                global_step += 1

        avg_loss = epoch_loss / max(1, n_batches)
        LOG.info("epoch %d/%d  loss=%.4f  steps=%d", epoch + 1, args.epochs, avg_loss, global_step)

    # 5. Save LoRA adapter.
    pipe.transformer.save_pretrained(str(out_dir))
    LOG.info("saved LoRA adapter to %s", out_dir)

    # Write training summary.
    training_summary = {
        "base_model": args.base_model,
        "adapter_kind": "short-clip-stems-v1",
        "rank": args.rank,
        "alpha": args.alpha,
        "epochs": args.epochs,
        "clips_trained": len(clip_files),
        "global_steps": global_step,
        "output_dir": str(out_dir),
    }
    (out_dir / "training_summary.json").write_text(
        json.dumps(training_summary, indent=2) + "\n", encoding="utf-8"
    )

    if args.push_to_hub:
        LOG.info("pushing to HF Hub: %s …", args.push_to_hub)
        pipe.transformer.push_to_hub(args.push_to_hub)
        LOG.info("pushed to %s", args.push_to_hub)

    LOG.info("Stable Audio Open LoRA training complete.")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
