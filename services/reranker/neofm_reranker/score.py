"""Score WAV files against a reranker checkpoint.

Used by the worker (when `top_n_candidates > 1`) and by
`evals/v1.4-bench/scripts/score_run.py`. The function is split into
two layers:

  - `score_with_head(head, audio_paths)`: uses the in-memory head.
  - `score_paths(audio_paths, checkpoint_path=None)`: convenience
    wrapper that loads a checkpoint (or falls back to a fresh head
    when the checkpoint is missing).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .model import HeadConfig, RerankerHead


@dataclass(frozen=True)
class CandidateScore:
    audio_path: str
    score: float


def load_checkpoint(path: Path) -> RerankerHead | None:
    if not path.is_file():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    config = HeadConfig(**raw["config"])
    return RerankerHead(
        config=config,
        w1=raw["w1"],
        b1=raw["b1"],
        w2=raw["w2"],
        b2=float(raw["b2"]),
    )


def save_checkpoint(head: RerankerHead, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "config": {
            "in_dim": head.config.in_dim,
            "hidden_dim": head.config.hidden_dim,
            "dropout": head.config.dropout,
            "init_seed": head.config.init_seed,
        },
        "w1": head.w1,
        "b1": head.b1,
        "w2": head.w2,
        "b2": head.b2,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def score_with_head(
    head: RerankerHead,
    audio_paths: list[str],
) -> list[CandidateScore]:
    return [CandidateScore(audio_path=p, score=head.score(p)) for p in audio_paths]


def score_paths(
    audio_paths: list[str],
    *,
    checkpoint_path: Path | None = None,
) -> list[CandidateScore]:
    head = (
        load_checkpoint(checkpoint_path)
        if checkpoint_path is not None
        else None
    )
    if head is None:
        head = RerankerHead.from_config(HeadConfig())
    return score_with_head(head, audio_paths)


def pick_best(scores: list[CandidateScore]) -> CandidateScore:
    if not scores:
        raise ValueError("pick_best requires at least one score")
    return max(scores, key=lambda s: s.score)
