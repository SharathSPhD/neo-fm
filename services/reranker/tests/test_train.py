"""Reranker training loop -- dry-run path only (CI-safe)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from neofm_reranker import train
from neofm_reranker.score import load_checkpoint, pick_best, score_paths


def test_train_dry_run_writes_checkpoint(tmp_path, monkeypatch):
    monkeypatch.setattr(train, "CHECKPOINT_ROOT", tmp_path)
    result = train.train(dry_run=True, epochs=2, run_id="test-run")
    assert result.checkpoint_path.is_file()
    head = load_checkpoint(result.checkpoint_path)
    assert head is not None
    assert head.config.in_dim == 768


def test_train_dry_run_updates_latest_symlink(tmp_path, monkeypatch):
    monkeypatch.setattr(train, "CHECKPOINT_ROOT", tmp_path)
    train.train(dry_run=True, epochs=1, run_id="first")
    train.train(dry_run=True, epochs=1, run_id="second")
    latest = tmp_path / "latest"
    assert latest.exists()


def test_train_dry_run_records_row_count_and_epochs(tmp_path, monkeypatch):
    monkeypatch.setattr(train, "CHECKPOINT_ROOT", tmp_path)
    result = train.train(dry_run=True, epochs=3, run_id="counts")
    assert result.epochs == 3
    assert result.rows_used == 64  # synthetic dataset size


def test_train_apply_without_dataset_raises(tmp_path, monkeypatch):
    monkeypatch.setattr(train, "CHECKPOINT_ROOT", tmp_path)
    with pytest.raises(ValueError, match="dataset-path"):
        train.train(dry_run=False)


def test_score_paths_consistent_with_checkpoint(tmp_path, monkeypatch):
    monkeypatch.setattr(train, "CHECKPOINT_ROOT", tmp_path)
    result = train.train(dry_run=True, epochs=1, run_id="score-test")
    scored = score_paths(
        ["tracks/x.wav", "tracks/y.wav"],
        checkpoint_path=result.checkpoint_path,
    )
    assert len(scored) == 2
    best = pick_best(scored)
    assert best.audio_path in {s.audio_path for s in scored}


def test_pick_best_raises_on_empty():
    with pytest.raises(ValueError):
        pick_best([])


def test_synthetic_dataset_has_distinct_winners_and_losers():
    ds = train._make_synthetic_dataset(8)
    for row in ds:
        assert row.winner_audio_path != row.loser_audio_path
