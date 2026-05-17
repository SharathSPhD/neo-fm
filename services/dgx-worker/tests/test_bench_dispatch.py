"""Tests for the bench dispatcher.

The dispatcher is a thin validation + JSONL-writing layer between the
eval scaffold (`evals/v1.4-bench`) and the GPU-side worker. We never
mock the worker here -- the validation is the whole product.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app import bench_dispatch


def _row(
    *,
    prompt_id: str = "carnatic-001",
    candidate_index: int = 0,
    seed: int | None = None,
) -> dict[str, object]:
    if seed is None:
        seed = 1000 + candidate_index
    return {
        "prompt_id": prompt_id,
        "style": "carnatic",
        "language": "hi",
        "candidate_index": candidate_index,
        "seed": seed,
        "lyrics_seed": "demo seed",
        "duration_seconds": 60,
        "engine": "current",
        "voice_persona": "indic_hi_female_lyrical",
    }


def _manifest(rows: list[dict[str, object]], *, top_n: int) -> dict[str, object]:
    return {
        "engine": "current",
        "top_n": top_n,
        "prompt_count": len({r["prompt_id"] for r in rows}),
        "candidate_count": len(rows),
        "generated_at": "2026-05-17T15:00:00Z",
        "candidates": rows,
    }


def test_validate_manifest_happy_path():
    rows = [_row(prompt_id="x-001", candidate_index=k, seed=k + 100) for k in range(4)]
    candidates = bench_dispatch.validate_manifest(_manifest(rows, top_n=4))
    assert len(candidates) == 4
    assert {c.candidate_index for c in candidates} == {0, 1, 2, 3}


def test_validate_manifest_rejects_missing_engine():
    rows = [_row(prompt_id="x-001", candidate_index=k, seed=k) for k in range(2)]
    m = _manifest(rows, top_n=2)
    m["engine"] = ""
    with pytest.raises(ValueError, match="engine"):
        bench_dispatch.validate_manifest(m)


def test_validate_manifest_rejects_zero_top_n():
    rows = [_row(prompt_id="x-001", candidate_index=k, seed=k) for k in range(2)]
    m = _manifest(rows, top_n=2)
    m["top_n"] = 0
    with pytest.raises(ValueError, match="top_n"):
        bench_dispatch.validate_manifest(m)


def test_validate_manifest_rejects_empty_candidates():
    m = _manifest([], top_n=4)
    with pytest.raises(ValueError, match="no candidates"):
        bench_dispatch.validate_manifest(m)


def test_validate_manifest_rejects_duplicate_prompt_seed():
    rows = [_row(prompt_id="x-001", candidate_index=0, seed=1) for _ in range(2)]
    rows.append(_row(prompt_id="x-001", candidate_index=2, seed=2))
    rows.append(_row(prompt_id="x-001", candidate_index=3, seed=3))
    with pytest.raises(ValueError, match="duplicate"):
        bench_dispatch.validate_manifest(_manifest(rows, top_n=4))


def test_validate_manifest_rejects_uneven_per_prompt_count():
    rows = [_row(prompt_id="x-001", candidate_index=k, seed=k) for k in range(3)]
    rows.extend(
        _row(prompt_id="x-002", candidate_index=k, seed=100 + k) for k in range(4)
    )
    with pytest.raises(ValueError, match="expected"):
        bench_dispatch.validate_manifest(_manifest(rows, top_n=4))


def test_dispatch_writes_jsonl(tmp_path: Path):
    rows = [
        _row(prompt_id="x-001", candidate_index=k, seed=k + 100) for k in range(4)
    ]
    written = bench_dispatch.dispatch(_manifest(rows, top_n=4), run_dir=tmp_path)
    assert written == 4
    path = tmp_path / "dispatch.jsonl"
    assert path.is_file()
    decoded = [json.loads(line) for line in path.read_text().splitlines()]
    assert {row["candidate_index"] for row in decoded} == {0, 1, 2, 3}
    assert all(row["engine"] == "current" for row in decoded)


def test_select_best_candidate_picks_max_score(monkeypatch):
    candidates = [(0, "audio-a.wav"), (1, "audio-b.wav"), (2, "audio-c.wav")]
    selection = bench_dispatch.select_best_candidate(
        job_id="job-1",
        candidate_audio_paths=candidates,
    )
    assert selection.job_id == "job-1"
    assert selection.chosen_candidate_index in (0, 1, 2)
    scores = dict(selection.all_scores)
    assert scores[selection.chosen_candidate_index] == max(scores.values())


def test_select_best_candidate_rejects_empty():
    with pytest.raises(ValueError):
        bench_dispatch.select_best_candidate(
            job_id="job-1", candidate_audio_paths=[],
        )


def test_select_best_candidate_returns_one_score_per_input():
    candidates = [(0, "audio-a.wav"), (1, "audio-b.wav"), (2, "audio-c.wav")]
    selection = bench_dispatch.select_best_candidate(
        job_id="job-1",
        candidate_audio_paths=candidates,
    )
    assert len(selection.all_scores) == 3
    indices = [idx for idx, _ in selection.all_scores]
    assert sorted(indices) == [0, 1, 2]


def test_bench_candidate_from_row_coerces_types():
    candidate = bench_dispatch.BenchCandidate.from_row(
        {
            "prompt_id": "x-1",
            "style": "carnatic",
            "language": "hi",
            "candidate_index": "2",
            "seed": "12345",
            "lyrics_seed": "x",
            "duration_seconds": "60",
            "engine": "current",
            "voice_persona": "indic_hi_female_lyrical",
        },
    )
    assert candidate.candidate_index == 2
    assert candidate.seed == 12345
    assert candidate.duration_seconds == 60
