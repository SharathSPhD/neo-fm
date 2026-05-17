"""Bench dispatcher entry point used by `evals/v1.4-bench/run_bench.py`.

The run_bench script imports this lazily so the eval scaffold runs in
CI (where the worker deps are absent), but a DGX-side `--apply` can
actually enqueue 400 candidate renders.

Design choices:
  - The dispatcher does *not* talk to Supabase directly. It writes one
    JSON-Lines file per run, which a separate
    `services/dgx-worker/app/bench_runner` (out-of-scope here) reads
    and feeds through `process_one` with `top_n_candidates` set.
  - This keeps the bench dispatcher pure / unit-testable without
    needing a DB. Tests in `services/dgx-worker/tests/test_bench_dispatch.py`
    cover the schema and idempotency.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent


def _load_reranker_score_module() -> tuple[Callable[..., Any], Callable[..., Any]]:
    """Import the reranker's score module without name collisions.

    services/dgx-worker uses `app.*` for its own modules. The reranker
    therefore lives under the distinct package name `neofm_reranker`
    so importing it from the worker is safe even when the worker's
    own `app` package is already on sys.path.
    """
    reranker_pkg = _REPO_ROOT / "services" / "reranker"
    if str(reranker_pkg) not in sys.path:
        sys.path.insert(0, str(reranker_pkg))
    from neofm_reranker.score import pick_best, score_paths  # type: ignore[import-not-found]

    return pick_best, score_paths


@dataclass(frozen=True)
class BenchCandidate:
    """One candidate render request."""

    prompt_id: str
    style: str
    language: str
    candidate_index: int
    seed: int
    lyrics_seed: str
    duration_seconds: int
    engine: str
    voice_persona: str

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> BenchCandidate:
        return cls(
            prompt_id=str(row["prompt_id"]),
            style=str(row["style"]),
            language=str(row["language"]),
            candidate_index=int(row["candidate_index"]),
            seed=int(row["seed"]),
            lyrics_seed=str(row["lyrics_seed"]),
            duration_seconds=int(row["duration_seconds"]),
            engine=str(row["engine"]),
            voice_persona=str(row["voice_persona"]),
        )


def validate_manifest(manifest: dict[str, Any]) -> list[BenchCandidate]:
    """Raise ValueError if the manifest is malformed; return parsed candidates."""
    if "candidates" not in manifest:
        raise ValueError("manifest missing 'candidates'")
    if "engine" not in manifest or not str(manifest["engine"]):
        raise ValueError("manifest missing/empty 'engine'")
    top_n = int(manifest.get("top_n", 0))
    if top_n <= 0:
        raise ValueError(f"top_n must be > 0, got {top_n}")
    candidates = [BenchCandidate.from_row(row) for row in manifest["candidates"]]
    if not candidates:
        raise ValueError("manifest has no candidates")
    seen: set[tuple[str, int]] = set()
    for c in candidates:
        key = (c.prompt_id, c.seed)
        if key in seen:
            raise ValueError(f"duplicate prompt_id+seed: {key}")
        seen.add(key)
    prompt_to_count: dict[str, int] = {}
    for c in candidates:
        prompt_to_count[c.prompt_id] = prompt_to_count.get(c.prompt_id, 0) + 1
    for prompt_id, count in prompt_to_count.items():
        if count != top_n:
            raise ValueError(
                f"prompt {prompt_id} has {count} candidates, expected {top_n}",
            )
    return candidates


def write_dispatch_jsonl(
    candidates: list[BenchCandidate],
    *,
    out_path: Path,
) -> int:
    """Write one JSONL row per candidate to `out_path`. Returns row count."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        for c in candidates:
            fh.write(
                json.dumps(
                    {
                        "prompt_id": c.prompt_id,
                        "style": c.style,
                        "language": c.language,
                        "candidate_index": c.candidate_index,
                        "seed": c.seed,
                        "lyrics_seed": c.lyrics_seed,
                        "duration_seconds": c.duration_seconds,
                        "engine": c.engine,
                        "voice_persona": c.voice_persona,
                    },
                )
                + "\n",
            )
    return len(candidates)


def dispatch(manifest: dict[str, Any], *, run_dir: Path) -> int:
    """Validate the manifest and emit dispatch.jsonl. Returns row count."""
    candidates = validate_manifest(manifest)
    return write_dispatch_jsonl(candidates, out_path=run_dir / "dispatch.jsonl")


@dataclass(frozen=True)
class CandidateSelection:
    """Reranker output: which candidate to mark `is_current=true`."""

    job_id: str
    chosen_candidate_index: int
    chosen_score: float
    all_scores: tuple[tuple[int, float], ...]


def select_best_candidate(
    *,
    job_id: str,
    candidate_audio_paths: list[tuple[int, str]],
    checkpoint_path: Path | None = None,
) -> CandidateSelection:
    """Score each candidate WAV and return the winning candidate_index.

    `candidate_audio_paths` is a list of `(candidate_index, audio_path)`
    tuples (the path can be a local file or a Storage object key --
    the reranker only hashes the string for its CI proxy, and on DGX
    pulls the actual bytes through MERT-95M).

    Loads the reranker checkpoint lazily so the worker still boots
    when no checkpoint has been trained yet (CI / fresh deployments).
    """
    if not candidate_audio_paths:
        raise ValueError("select_best_candidate requires at least one candidate")
    # Load the reranker scoring module from its file location rather
    # than importing through any package path -- the dgx-worker's own
    # `app/` package would collide with `services/reranker/app/`
    # otherwise. This lazy load keeps `services.reranker` off the
    # boot-time import path entirely.
    pick_best, score_paths = _load_reranker_score_module()

    paths = [p for (_idx, p) in candidate_audio_paths]
    scores = score_paths(paths, checkpoint_path=checkpoint_path)
    index_by_path = {p: idx for (idx, p) in candidate_audio_paths}
    best = pick_best(scores)
    return CandidateSelection(
        job_id=job_id,
        chosen_candidate_index=index_by_path[best.audio_path],
        chosen_score=best.score,
        all_scores=tuple(
            (index_by_path[s.audio_path], s.score) for s in scores
        ),
    )
