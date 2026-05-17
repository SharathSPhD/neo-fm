"""Train the v1.4 Sprint 14 chant-style LoRA adapter on DGX Spark.

The adapter is a **style LoRA** — not a new vocal backend. It rides
on top of whichever Indic vocal model has the best baseline shloka
MOS (the operator decides at training time by passing
``--base indicf5`` or ``--base nemo``). Both base models keep
their weights frozen; the LoRA adds a small (rank 16) low-rank
parameter delta that nudges the prosody toward Vedic chant.

Pipeline (real-mode, DGX only):

  1. Read the manifest emitted by ``curate_sanskrit_chant.py``.
     The chant manifest carries ``svara_marks`` + ``mantra_id``
     beyond the standard NeMo fields.
  2. Materialise per-syllable conditioning targets: udatta /
     anudatta / svarita become +1 / -1 / 0 pitch-bias features
     fed alongside the standard phoneme stream.
  3. Train rank-16 LoRA over the chosen base model. ~12 GPU-hours
     on the GB10 for ~30 h of curated chant audio. The script
     itself does **not** import the base toolkit — the operator
     wraps this script with the right environment per ADR 0034.
  4. Drop ``chant_style_lora.safetensors`` + ``adapter_config.json``
     + ``svara_calibration.json`` (the pitch-bias scaling table)
     into ``--out-dir``.
  5. (Operator step) ``hf upload neo-fm/chant-style-v1
     <out-dir>`` and stage the dir at the running vocal-synth
     service's ``VOCAL_CHANT_LORA_DIR``.

CI runs ``--dry-run``, which:

  - Validates the chant manifest's schema (svara labels, mantra
    ids, durations).
  - Writes empty ``chant_style_lora.safetensors`` +
    ``adapter_config.json`` + ``svara_calibration.json``
    placeholders so the in-service loader contract is exercised
    end-to-end.
  - Skips any model toolkit import (CI doesn't ship NeMo or
    IndicF5).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

BaseModel = Literal["indicf5", "nemo"]

_VALID_SVARAS: frozenset[str] = frozenset({"anudatta", "udatta", "svarita"})


@dataclass(frozen=True)
class LoraConfig:
    """v1.4 Sprint 14 chant-LoRA hyperparameters.

    Rank 16 was chosen per the v1.4 plan: large enough to capture
    chant prosody, small enough to keep adapter size under 10 MB
    (so we can ship multiple per-style adapters via HF Hub without
    bloating the runtime image).
    """

    rank: int = 16
    alpha: int = 32
    dropout: float = 0.05
    learning_rate: float = 1e-4
    epochs: int = 40
    batch_size: int = 8
    target_modules: tuple[str, ...] = ("q_proj", "k_proj", "v_proj", "o_proj")


DEFAULT_LORA_CONFIG = LoraConfig()


def load_manifest(path: Path) -> list[dict[str, object]]:
    """Parse the augmented chant manifest.

    Raises if any row violates the schema
    :func:`curate_sanskrit_chant.validate_rows` enforced.
    """
    rows: list[dict[str, object]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        row = json.loads(line)
        for required in (
            "audio_filepath",
            "duration",
            "text",
            "speaker_id",
            "mantra_id",
            "svara_marks",
        ):
            if required not in row:
                raise ValueError(f"manifest row missing {required!r}: {row}")
        if not (2.0 <= float(row["duration"]) <= 30.0):
            raise ValueError(
                f"manifest row {row['audio_filepath']!r} duration "
                f"{row['duration']}s outside [2, 30]s"
            )
        if not str(row["text"]).strip():
            raise ValueError(
                f"manifest row {row['audio_filepath']!r} has empty text"
            )
        marks = row["svara_marks"]
        if not isinstance(marks, list):
            raise ValueError(
                f"manifest row {row['audio_filepath']!r} svara_marks "
                "must be a list"
            )
        seen: set[int] = set()
        for m in marks:
            if not isinstance(m, dict):
                raise ValueError(
                    f"manifest row {row['audio_filepath']!r} mark "
                    f"is not a dict: {m!r}"
                )
            svara = m.get("svara")
            if svara not in _VALID_SVARAS:
                raise ValueError(
                    f"manifest row {row['audio_filepath']!r} mark "
                    f"has invalid svara {svara!r}"
                )
            idx = m.get("syllable_index")
            if not isinstance(idx, int) or idx < 0:
                raise ValueError(
                    f"manifest row {row['audio_filepath']!r} mark "
                    f"has invalid syllable_index {idx!r}"
                )
            if idx in seen:
                raise ValueError(
                    f"manifest row {row['audio_filepath']!r} has "
                    f"duplicate syllable_index {idx}"
                )
            seen.add(idx)
        rows.append(row)
    if not rows:
        raise ValueError(f"manifest {path} is empty")
    return rows


def build_svara_calibration(
    rows: list[dict[str, object]],
) -> dict[str, float]:
    """Return per-svara pitch-bias scale factors.

    The chant LoRA conditions on a three-element vector
    ``(udatta, anudatta, svarita)`` summing to 1. The calibration
    table records the **median sustained duration** for each svara
    in the corpus; the LoRA uses these as the soft target for the
    duration predictor head. Sprint 16's eval rescales these per
    mantra family if needed.
    """
    buckets: dict[str, list[float]] = {s: [] for s in _VALID_SVARAS}
    for row in rows:
        marks = row.get("svara_marks", [])
        if not isinstance(marks, list):
            continue
        for m in marks:
            if not isinstance(m, dict):
                continue
            s = m.get("svara")
            d = m.get("duration_s")
            if s in _VALID_SVARAS and isinstance(d, (int, float)) and d > 0:
                buckets[str(s)].append(float(d))
    calibration: dict[str, float] = {}
    for svara, samples in buckets.items():
        if not samples:
            calibration[svara] = 0.0
            continue
        sorted_samples = sorted(samples)
        mid = len(sorted_samples) // 2
        if len(sorted_samples) % 2 == 1:
            calibration[svara] = round(sorted_samples[mid], 4)
        else:
            calibration[svara] = round(
                (sorted_samples[mid - 1] + sorted_samples[mid]) / 2.0,
                4,
            )
    return calibration


def write_placeholder_artifacts(
    out_dir: Path,
    *,
    base_model: BaseModel,
    config: LoraConfig,
    calibration: dict[str, float],
) -> None:
    """Dry-run only: drop empty LoRA + config + calibration so the
    in-service loader exercises the full on-disk contract."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "chant_style_lora.safetensors").write_bytes(b"\x00")
    (out_dir / "adapter_config.json").write_text(
        json.dumps(
            {
                "base_model": base_model,
                "adapter_id": "neo-fm/chant-style-v1",
                "rank": config.rank,
                "alpha": config.alpha,
                "dropout": config.dropout,
                "target_modules": list(config.target_modules),
                "epochs": config.epochs,
                "learning_rate": config.learning_rate,
                "batch_size": config.batch_size,
                "task": "vocal-style",
                "style_family": "sanskrit-shloka",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (out_dir / "svara_calibration.json").write_text(
        json.dumps(calibration, ensure_ascii=False),
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--manifest",
        type=Path,
        required=True,
        help="Augmented chant JSONL manifest from curate_sanskrit_chant.py.",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        required=True,
        help=(
            "Where to drop chant_style_lora.safetensors, "
            "adapter_config.json, svara_calibration.json."
        ),
    )
    ap.add_argument(
        "--base",
        choices=("indicf5", "nemo"),
        default="indicf5",
        help="Base model to host the LoRA. Default indicf5 because "
        "Sprint 14 finds IndicF5's Sanskrit baseline MOS slightly "
        "higher than NeMo's on shloka prompts; the operator can "
        "flip via --base nemo if the eval reverses.",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="CI-only: validate manifest + emit placeholder artefacts.",
    )
    args = ap.parse_args()

    rows = load_manifest(args.manifest)
    calibration = build_svara_calibration(rows)

    if args.dry_run:
        write_placeholder_artifacts(
            args.out_dir,
            base_model=args.base,
            config=DEFAULT_LORA_CONFIG,
            calibration=calibration,
        )
        total_hours = sum(float(r["duration"]) for r in rows) / 3600.0
        print(
            f"[dry-run] validated {len(rows)} chant rows "
            f"({total_hours:.4f} h), base={args.base}, wrote "
            f"placeholders to {args.out_dir}; svara calibration "
            f"medians: {calibration}.",
            file=sys.stderr,
        )
        return 0

    print(
        "real-mode chant-LoRA training is DGX-only; see "
        "docs/DECISIONS/0034-sanskrit-chant-style-adapter.md for the "
        "operator shell-script wrapper.",
        file=sys.stderr,
    )
    return 1


__all__ = [
    "DEFAULT_LORA_CONFIG",
    "BaseModel",
    "LoraConfig",
    "build_svara_calibration",
    "load_manifest",
    "main",
    "write_placeholder_artifacts",
]


if __name__ == "__main__":
    raise SystemExit(main())
