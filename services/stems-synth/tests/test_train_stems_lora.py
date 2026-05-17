"""Tests for `scripts/train_stems_lora.py` (v1.4 Sprint 11)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import train_stems_lora  # noqa: E402


def _seed_corpus(tmp_path: Path) -> Path:
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    (corpus / "summary.json").write_text(
        json.dumps(
            {
                "clip_count": 120,
                "total_hours": 1.6,
                "by_license_seconds": {"cc-by-nc-sa": 5400.0},
                "by_source_clips": {"saraga": 120},
                "splits": {
                    "train_clip_ids": [f"s{i:03d}" for i in range(108)],
                    "eval_clip_ids": [f"s{i:03d}" for i in range(108, 120)],
                },
            },
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    return corpus


def _args(corpus: Path, out: Path) -> argparse.Namespace:
    return argparse.Namespace(
        corpus=corpus,
        output_dir=out,
        base_model="stabilityai/stable-audio-open-1.0",
        rank=16,
        alpha=32,
        dropout=0.05,
        lr=1e-4,
        epochs=8,
        batch_size=4,
        grad_accum=4,
        fp16=True,
        target_modules=["to_q", "to_k", "to_v", "to_out"],
        push_to_hub=None,
        trackio_project="neo-fm/stems-lora",
        dry_run=True,
        log_level="INFO",
    )


def test_default_hub_repo_pins_to_v14_name() -> None:
    assert (
        train_stems_lora.DEFAULT_HUB_REPO
        == "neo-fm/stable-audio-open-stems-lora-v1"
    )


def test_dry_run_summary_shape(tmp_path: Path) -> None:
    corpus = _seed_corpus(tmp_path)
    summary = train_stems_lora.build_dry_run_summary(
        _args(corpus, tmp_path / "out")
    )
    assert summary["engine"] == "stable-audio-open"
    assert summary["adapter_kind"] == "short-clip-stems-v1"
    assert summary["base_model"] == "stabilityai/stable-audio-open-1.0"
    assert summary["rank"] == 16
    assert summary["alpha"] == 32
    assert summary["train_clip_count"] == 108
    assert summary["eval_clip_count"] == 12
    assert summary["effective_batch"] == 16
    assert summary["target_modules"] == ["to_q", "to_k", "to_v", "to_out"]
    assert summary["fp16"] is True


def test_dry_run_summary_raises_on_missing_corpus(tmp_path: Path) -> None:
    args = _args(tmp_path / "missing", tmp_path / "out")
    with pytest.raises(SystemExit, match=r"missing summary\.json"):
        train_stems_lora.build_dry_run_summary(args)
