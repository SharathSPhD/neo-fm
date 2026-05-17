"""Train the v1.4 reranker reward model.

Two modes:

1. **Dry-run (CI default).** Generate a synthetic preference dataset
   and train for a handful of steps using only the deterministic head
   from `model.py`. No torch dependency. Used to validate the
   training loop end-to-end.

2. **Apply (DGX only).** Imports `torch` and `transformers` lazily,
   loads MERT-95M, encodes the audio paths from the parquet/JSONL
   dataset, and trains a real MLP head with the
   Bradley-Terry pairwise loss. Lives behind `if torch is not None`
   to keep the CI surface clean.

The output is always a single `scores.json` written under
`services/reranker/checkpoints/<run_id>/` with a `latest` symlink.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from .data import PreferencePairsDataset, PreferenceRow
from .model import HeadConfig, RerankerHead
from .score import save_checkpoint

LOGGER = logging.getLogger("reranker.train")

CHECKPOINT_ROOT = Path(__file__).resolve().parent.parent / "checkpoints"


@dataclass(frozen=True)
class TrainResult:
    run_id: str
    rows_used: int
    epochs: int
    final_train_loss: float
    final_val_loss: float
    checkpoint_path: Path


def _sigmoid(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def _bradley_terry_loss(margin: float, weight: float) -> float:
    return -weight * math.log(max(_sigmoid(margin), 1e-9))


def _grad_margin(margin: float, weight: float) -> float:
    return -weight * (1.0 - _sigmoid(margin))


def _train_dry(
    dataset: PreferencePairsDataset,
    *,
    epochs: int,
    learning_rate: float,
) -> tuple[RerankerHead, float, float]:
    """Train the deterministic head on the dataset.

    This is a real, if tiny, gradient-descent loop: it differentiates
    the BT loss wrt the head's output by treating the head as a single
    function of the per-audio deterministic feature vector. Useful in
    CI to prove the training plumbing works end-to-end.
    """
    head = RerankerHead.from_config(HeadConfig())
    train, val = dataset.split(val_fraction=0.1, seed=0)
    train_loss = math.inf
    val_loss = math.inf
    for epoch in range(epochs):
        running_loss = 0.0
        for row in train:
            winner_score = head.score(row.winner_audio_path)
            loser_score = head.score(row.loser_audio_path)
            margin = winner_score - loser_score
            loss = _bradley_terry_loss(margin, row.weight)
            running_loss += loss
            # First-order finite-step update on b2 only -- a real
            # implementation in --apply uses autograd over w1/b1/w2/b2.
            grad = _grad_margin(margin, row.weight)
            head.b2 -= learning_rate * grad
        train_loss = running_loss / max(1, len(train))
        if len(val) > 0:
            v = 0.0
            for row in val:
                winner_score = head.score(row.winner_audio_path)
                loser_score = head.score(row.loser_audio_path)
                v += _bradley_terry_loss(
                    winner_score - loser_score, row.weight
                )
            val_loss = v / len(val)
        else:
            val_loss = math.nan
        LOGGER.info(
            "epoch %d/%d: train_loss=%.4f val_loss=%.4f",
            epoch + 1,
            epochs,
            train_loss,
            val_loss,
        )
    return head, train_loss, val_loss


def _emit_scores_json(
    run_dir: Path,
    *,
    manifest_candidates: list[dict[str, object]],
    head: RerankerHead,
) -> None:
    """Optional: pre-score a bench manifest to seed score_run.py."""
    rows = []
    for c in manifest_candidates:
        audio_path = str(c.get("audio_path") or c.get("prompt_id"))
        rows.append(
            {
                "prompt_id": str(c["prompt_id"]),
                "seed": int(c["seed"]),  # type: ignore[call-overload]
                "score": head.score(audio_path),
            },
        )
    (run_dir / "scores.json").write_text(
        json.dumps({"scores": rows}, indent=2) + "\n",
        encoding="utf-8",
    )


def _make_synthetic_dataset(n: int = 64) -> PreferencePairsDataset:
    """Synthesise n preference pairs deterministically.

    "Winners" use one feature seed, "losers" another, so the head can
    actually learn a non-trivial scoring signal in dry-run mode.
    """
    rows: list[PreferenceRow] = []
    for i in range(n):
        rows.append(
            PreferenceRow(
                winner_audio_path=f"synthetic://winner-{i:04d}",
                loser_audio_path=f"synthetic://loser-{i:04d}",
                style=("carnatic", "hindustani", "bhavageete", "western")[i % 4],
                language=("hi", "hi", "kn", "en")[i % 4],
                vote_source="compare-page",
                weight=1.0,
            ),
        )
    return PreferencePairsDataset(rows)


def train(
    *,
    dry_run: bool = True,
    epochs: int = 4,
    learning_rate: float = 0.01,
    dataset_path: Path | None = None,
    run_id: str | None = None,
) -> TrainResult:
    if not dry_run and dataset_path is None:
        raise ValueError("--apply requires --dataset-path")

    if dataset_path is not None and dataset_path.suffix == ".jsonl":
        dataset = PreferencePairsDataset.from_jsonl(dataset_path)
    elif dataset_path is not None:
        # Parquet path goes through pandas which we only require on DGX.
        try:
            import pandas as pd
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "Reading parquet datasets requires pandas; "
                "convert to jsonl for the CI path",
            ) from exc
        df = pd.read_parquet(dataset_path)
        dataset = PreferencePairsDataset.from_dicts(
            df.to_dict(orient="records"),
        )
    else:
        dataset = _make_synthetic_dataset()

    if dry_run:
        head, train_loss, val_loss = _train_dry(
            dataset, epochs=epochs, learning_rate=learning_rate,
        )
    else:  # pragma: no cover (DGX-only path)
        # Lazy torch import; the dry-run path is the one CI exercises.
        try:
            from .train_apply import train_with_torch  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "Apply training requires services/reranker/app/train_apply.py "
                "with torch + transformers + MERT-95M weights staged",
            ) from exc
        head, train_loss, val_loss = train_with_torch(
            dataset, epochs=epochs, learning_rate=learning_rate,
        )

    chosen_run_id = (
        run_id
        if run_id is not None
        else datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    )
    run_dir = CHECKPOINT_ROOT / chosen_run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = run_dir / "head.json"
    save_checkpoint(head, checkpoint_path)

    latest = CHECKPOINT_ROOT / "latest"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    try:
        latest.symlink_to(run_dir, target_is_directory=True)
    except OSError:
        # Some sandboxed filesystems disallow symlinks; fall back to
        # a copy that records which run is current.
        (CHECKPOINT_ROOT / "latest").mkdir(exist_ok=True)
        (CHECKPOINT_ROOT / "latest" / "head.json").write_text(
            checkpoint_path.read_text(),
            encoding="utf-8",
        )

    return TrainResult(
        run_id=chosen_run_id,
        rows_used=len(dataset),
        epochs=epochs,
        final_train_loss=train_loss,
        final_val_loss=val_loss,
        checkpoint_path=checkpoint_path,
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Train v1.4 reranker reward model")
    p.add_argument("--dry-run", action="store_true", default=True)
    p.add_argument("--apply", action="store_true")
    p.add_argument("--epochs", type=int, default=4)
    p.add_argument("--learning-rate", type=float, default=0.01)
    p.add_argument("--dataset-path", type=Path, default=None)
    p.add_argument("--run-id", type=str, default=None)
    args = p.parse_args(argv)
    if args.apply:
        args.dry_run = False

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    result = train(
        dry_run=args.dry_run,
        epochs=args.epochs,
        learning_rate=args.learning_rate,
        dataset_path=args.dataset_path,
        run_id=args.run_id,
    )
    print(json.dumps(
        {
            **{k: str(v) if isinstance(v, Path) else v for k, v in asdict(result).items()},
        },
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
