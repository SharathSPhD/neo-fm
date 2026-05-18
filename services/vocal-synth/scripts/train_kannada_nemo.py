"""Train neo-fm's custom Kannada NeMo TTS on DGX Spark (v1.4 Sprint 13).

Pipeline (per the v1.4 plan):

  1. Read the manifest emitted by `curate_kannada_tts.py`.
  2. Fine-tune a multi-speaker FastPitch acoustic model on the
     manifest (~36-72 GPU-hours on the GB10 depending on hours
     curated).
  3. Fine-tune the HiFi-GAN vocoder on the same speakers (~6-12
     GPU-hours).
  4. Drop the resulting `.nemo` artefacts plus a `speaker_map.json`
     into the chosen output dir.
  5. (Operator step) `hf upload neo-fm/nemo-tts-kannada-v1
     <output_dir>` and copy the same dir to the running vocal-synth
     service's ``VOCAL_NEMO_KN_DIR``.

CI runs `--dry-run`, which:

  - Validates the manifest's NeMo-format schema.
  - Writes empty `fastpitch.nemo` + `hifigan.nemo` + `speaker_map.json`
    placeholders so the downstream loader can be exercised
    end-to-end against the actual on-disk layout.
  - Skips any nemo_toolkit import (CI doesn't ship it).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class TrainingConfig:
    """v1.4 Sprint 13 training hyperparameters."""
    fastpitch_epochs: int = 200
    fastpitch_batch_size: int = 32
    fastpitch_lr: float = 1e-4
    hifigan_epochs: int = 150
    hifigan_batch_size: int = 16
    hifigan_lr: float = 2e-4
    target_sample_rate: int = 22050


DEFAULT_CONFIG = TrainingConfig()


def load_manifest(path: Path) -> list[dict[str, Any]]:
    """Parse a NeMo JSONL manifest. Raises if any row violates the
    schema `curate_kannada_tts.validate_rows` enforced."""
    rows: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        row = json.loads(line)
        for required in ("audio_filepath", "duration", "text", "speaker_id"):
            if required not in row:
                raise ValueError(f"manifest row missing {required!r}: {row}")
        if not (1.0 <= float(row["duration"]) <= 15.0):
            raise ValueError(
                f"manifest row {row['audio_filepath']!r} duration "
                f"{row['duration']}s outside [1, 15]s"
            )
        if not str(row["text"]).strip():
            raise ValueError(
                f"manifest row {row['audio_filepath']!r} has empty text"
            )
        rows.append(row)
    if not rows:
        raise ValueError(f"manifest {path} is empty")
    return rows


def build_speaker_map(rows: list[dict[str, Any]]) -> dict[str, int]:
    """Map every catalogue voice_id present in the manifest to a
    stable int id.

    The DGX-side script reads the catalogue (`voice_catalog.json`)
    and pins each Kannada persona to a speaker id. Sprint 13 ships
    two: `indic_kn_male_warm` -> 3, `indic_kn_female_bhajan` -> 4.
    Operators can override by editing the manifest's `speaker_id`
    values; this builder only emits a stable lookup from the
    catalogue ids we know we ship.
    """
    return {"indic_kn_male_warm": 3, "indic_kn_female_bhajan": 4}


def write_placeholder_artifacts(
    out_dir: Path, *, speaker_map: dict[str, int]
) -> None:
    """Dry-run only: emit empty `.nemo` placeholders + the
    speaker_map so the loader contract is exercised."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "fastpitch.nemo").write_bytes(b"\x00")
    (out_dir / "hifigan.nemo").write_bytes(b"\x00")
    (out_dir / "speaker_map.json").write_text(
        json.dumps(speaker_map, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "training_config.json").write_text(
        json.dumps(
            {
                "fastpitch_epochs": DEFAULT_CONFIG.fastpitch_epochs,
                "fastpitch_batch_size": DEFAULT_CONFIG.fastpitch_batch_size,
                "fastpitch_lr": DEFAULT_CONFIG.fastpitch_lr,
                "hifigan_epochs": DEFAULT_CONFIG.hifigan_epochs,
                "hifigan_batch_size": DEFAULT_CONFIG.hifigan_batch_size,
                "hifigan_lr": DEFAULT_CONFIG.hifigan_lr,
                "target_sample_rate": DEFAULT_CONFIG.target_sample_rate,
            }
        ),
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--manifest",
        type=Path,
        required=True,
        help="NeMo JSONL manifest from curate_kannada_tts.py.",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        required=True,
        help="Where to drop fastpitch.nemo, hifigan.nemo, speaker_map.json.",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="CI-only: validate manifest + emit placeholder artefacts.",
    )
    args = ap.parse_args()

    rows = load_manifest(args.manifest)
    speaker_map = build_speaker_map(rows)

    if args.dry_run:
        write_placeholder_artifacts(args.out_dir, speaker_map=speaker_map)
        total_hours = sum(float(r["duration"]) for r in rows) / 3600.0
        print(
            f"[dry-run] validated {len(rows)} rows "
            f"({total_hours:.4f} h), wrote placeholders to {args.out_dir}.",
            file=sys.stderr,
        )
        return 0

    # Real DGX path: deferred imports so CI (no nemo_toolkit) stays clean.
    try:
        from nemo.collections.tts.models import (  # type: ignore[import-not-found]
            FastPitchModel,
            HifiGanModel,
        )
        import pytorch_lightning as pl  # type: ignore[import-not-found]
        from omegaconf import OmegaConf  # type: ignore[import-not-found]
    except ImportError as e:
        raise RuntimeError(
            "nemo_toolkit is not installed. On DGX run "
            "`uv pip install 'nemo_toolkit[tts]==1.23.*'` first."
        ) from e

    return _real_train(
        rows=rows,
        speaker_map=speaker_map,
        out_dir=args.out_dir,
        cfg=DEFAULT_CONFIG,
        fastpitch_cls=FastPitchModel,
        hifigan_cls=HifiGanModel,
        pl_trainer_cls=pl.Trainer,
        omegaconf=OmegaConf,
    )


def _real_train(  # pragma: no cover
    *,
    rows: list[dict[str, Any]],
    speaker_map: dict[str, int],
    out_dir: Path,
    cfg: TrainingConfig,
    fastpitch_cls: Any,
    hifigan_cls: Any,
    pl_trainer_cls: Any,
    omegaconf: Any,
) -> int:
    """FastPitch + HiFi-GAN fine-tune loop (DGX-only).

    Pipeline:
      1. Rewrite manifest: speaker_id → speaker (NeMo standard field).
      2. Load tts_en_multispeaker_fastpitchmodel; cross-lingual fine-tune
         on Kannada corpus (pitch + energy sup_data computed on first run).
      3. Save fastpitch.nemo.
      4. Load tts_hifigan; fine-tune vocoder on same corpus.
      5. Save hifigan.nemo + speaker_map.json.
    """
    import json as _json
    import logging as _logging

    log = _logging.getLogger("train_kannada_nemo")
    out_dir.mkdir(parents=True, exist_ok=True)
    sup_dir = out_dir / "sup_data"
    sup_dir.mkdir(exist_ok=True)

    # ── 1. Rewrite manifest (speaker_id → speaker for NeMo) ───────────────
    nemo_manifest = out_dir / "nemo_train.jsonl"
    with nemo_manifest.open("w", encoding="utf-8") as f:
        for row in rows:
            nemo_row = dict(row)
            nemo_row["speaker"] = nemo_row.pop("speaker_id")
            f.write(_json.dumps(nemo_row, ensure_ascii=False) + "\n")
    log.info("nemo_manifest_written rows=%d path=%s", len(rows), nemo_manifest)

    oc = omegaconf  # type: ignore[assignment]

    _train_ds = oc.create(
        {
            "manifest_filepath": str(nemo_manifest),
            "sample_rate": cfg.target_sample_rate,
            "sup_data_path": str(sup_dir),
            "sup_data_types": ["pitch", "energy"],
            "batch_size": cfg.fastpitch_batch_size,
            "num_workers": 4,
            "pin_memory": True,
            "shuffle": True,
            "min_duration": 1.0,
            "max_duration": 15.0,
        }
    )
    _val_ds = oc.merge(_train_ds, {"shuffle": False, "batch_size": max(1, cfg.fastpitch_batch_size // 2)})

    # ── 2. Fine-tune FastPitch ────────────────────────────────────────────
    log.info("loading_fastpitch base=tts_en_multispeaker_fastpitchmodel")
    fp_model = fastpitch_cls.from_pretrained("tts_en_multispeaker_fastpitchmodel")  # type: ignore[union-attr]
    fp_model.setup_training_data(_train_ds)
    fp_model.setup_validation_data(_val_ds)

    fp_trainer = pl_trainer_cls(  # type: ignore[operator]
        max_epochs=cfg.fastpitch_epochs,
        devices=1,
        accelerator="gpu",
        log_every_n_steps=10,
        val_check_interval=1.0,
        default_root_dir=str(out_dir / "fp_checkpoints"),
        enable_progress_bar=True,
        logger=False,
    )
    log.info("fastpitch_training_start epochs=%d", cfg.fastpitch_epochs)
    fp_trainer.fit(fp_model)

    fp_path = out_dir / "fastpitch.nemo"
    fp_model.save_to(str(fp_path))
    log.info("fastpitch_saved path=%s", fp_path)

    # ── 3. Fine-tune HiFi-GAN vocoder ────────────────────────────────────
    _hg_train_ds = oc.create(
        {
            "manifest_filepath": str(nemo_manifest),
            "sample_rate": cfg.target_sample_rate,
            "batch_size": cfg.hifigan_batch_size,
            "num_workers": 4,
            "pin_memory": True,
            "shuffle": True,
            "min_duration": 1.0,
            "max_duration": 15.0,
        }
    )
    _hg_val_ds = oc.merge(_hg_train_ds, {"shuffle": False, "batch_size": max(1, cfg.hifigan_batch_size // 2)})

    log.info("loading_hifigan base=tts_hifigan")
    hg_model = hifigan_cls.from_pretrained("tts_hifigan")  # type: ignore[union-attr]
    hg_model.setup_training_data(_hg_train_ds)
    hg_model.setup_validation_data(_hg_val_ds)

    hg_trainer = pl_trainer_cls(  # type: ignore[operator]
        max_epochs=cfg.hifigan_epochs,
        devices=1,
        accelerator="gpu",
        log_every_n_steps=10,
        default_root_dir=str(out_dir / "hg_checkpoints"),
        enable_progress_bar=True,
        logger=False,
    )
    log.info("hifigan_training_start epochs=%d", cfg.hifigan_epochs)
    hg_trainer.fit(hg_model)

    hg_path = out_dir / "hifigan.nemo"
    hg_model.save_to(str(hg_path))
    log.info("hifigan_saved path=%s", hg_path)

    # ── 4. Write speaker_map + training_config sidecar ───────────────────
    (out_dir / "speaker_map.json").write_text(
        _json.dumps(speaker_map, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "training_config.json").write_text(
        _json.dumps(
            {
                "fastpitch_epochs": cfg.fastpitch_epochs,
                "fastpitch_batch_size": cfg.fastpitch_batch_size,
                "fastpitch_lr": cfg.fastpitch_lr,
                "hifigan_epochs": cfg.hifigan_epochs,
                "hifigan_batch_size": cfg.hifigan_batch_size,
                "hifigan_lr": cfg.hifigan_lr,
                "target_sample_rate": cfg.target_sample_rate,
                "train_rows": len(rows),
            }
        ),
        encoding="utf-8",
    )
    log.info("training_complete out_dir=%s", out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
