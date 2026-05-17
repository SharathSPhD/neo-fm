"""Tests for `scripts/train_bhavageete_lora.py` --dry-run.

The real trainer runs on DGX with heartlib/peft/torch; CI checks the
config-construction path is sane and stays in lockstep with the LoRA
attach code in `app/model.py`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import train_bhavageete_lora as trainer  # noqa: E402


def _write_corpus(tmp_path: Path) -> Path:
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    (corpus / "summary.json").write_text(
        json.dumps(
            {
                "clip_count": 20,
                "total_hours": 0.45,
                "by_license_seconds": {"cc-by-nc-sa": 800.0, "fair-use-§52": 820.0},
                "by_source_clips": {"saraga-kn": 10, "air-bengaluru": 10},
                "splits": {
                    "train_clip_ids": [f"clip{i:02d}" for i in range(18)],
                    "eval_clip_ids": ["clip18", "clip19"],
                },
            }
        ),
        encoding="utf-8",
    )
    return corpus


def test_dry_run_shape(tmp_path: Path) -> None:
    corpus = _write_corpus(tmp_path)
    argv = [
        "train_bhavageete_lora.py",
        "--corpus",
        str(corpus),
        "--output-dir",
        str(tmp_path / "out"),
        "--dry-run",
    ]
    old = sys.argv
    sys.argv = argv
    try:
        rc = trainer.main()
    finally:
        sys.argv = old
    assert rc == 0


def test_dry_run_summary_uses_corpus_split_sizes(tmp_path: Path) -> None:
    corpus = _write_corpus(tmp_path)
    import argparse

    args = argparse.Namespace(
        base_model="HeartMuLa/HeartMuLa-OSS-3B",
        ckpt_dir=Path("/mnt/models/heartmula/ckpt"),
        corpus=corpus,
        output_dir=tmp_path / "out",
        rank=32,
        alpha=64,
        dropout=0.05,
        lr=1e-4,
        epochs=5,
        batch_size=16,
        grad_accum=2,
        bf16=True,
        target_modules=[
            "q_proj",
            "v_proj",
            "k_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        push_to_hub=None,
        trackio_project="neo-fm/lora-tracker",
    )
    summary = trainer._dry_run_summary(args)
    assert summary["train_clip_count"] == 18
    assert summary["eval_clip_count"] == 2
    assert summary["rank"] == 32
    assert summary["alpha"] == 64
    assert summary["effective_batch"] == 32
    # The target modules MUST stay in lockstep with `app/model.py` —
    # heartlib's mula is a LLaMA-style decoder and the LoRA we're
    # producing here must attach to those names. If you change the
    # default target_modules in train_bhavageete_lora.py, update the
    # attach path in HeartMuLaModel._attach_adapter too.
    assert "q_proj" in summary["target_modules"]
    assert "v_proj" in summary["target_modules"]


def test_missing_corpus_summary_fails_loudly(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    import argparse

    args = argparse.Namespace(
        base_model="x",
        ckpt_dir=Path("/x"),
        corpus=empty,
        output_dir=tmp_path / "out",
        rank=32,
        alpha=64,
        dropout=0.05,
        lr=1e-4,
        epochs=5,
        batch_size=16,
        grad_accum=2,
        bf16=True,
        target_modules=["q_proj"],
        push_to_hub=None,
        trackio_project="x",
    )
    with pytest.raises(SystemExit, match=r"summary\.json"):
        trainer._dry_run_summary(args)
