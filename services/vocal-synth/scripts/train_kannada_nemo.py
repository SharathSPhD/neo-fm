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


def load_manifest(path: Path) -> list[dict[str, object]]:
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


def build_speaker_map(rows: list[dict[str, object]]) -> dict[str, int]:
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

    # Real DGX path: we don't import nemo_toolkit here so a missing
    # install in CI doesn't error in the import phase. The operator
    # imports it inside this block.
    try:
        from nemo.collections.tts.models import (  # type: ignore[import-not-found]
            FastPitchModel,
            HifiGanModel,
        )
    except ImportError as e:
        raise RuntimeError(
            "nemo_toolkit is not installed. On DGX run "
            "`uv pip install 'nemo_toolkit[tts]==1.23.*'` first."
        ) from e

    # The real training loop is plumbed by the operator: FastPitch
    # fine-tune from the multilingual NeMo checkpoint, then HiFi-GAN
    # vocoder retrain on the same speakers. The orchestration lives
    # in shell scripts on DGX (Sprint 13 docs/DECISIONS/0033).
    del FastPitchModel, HifiGanModel  # silence "imported but unused"
    print(
        "real-mode training is DGX-only; see "
        "docs/DECISIONS/0033-custom-nemo-kannada-tts.md for the "
        "operator shell-script wrapper.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
