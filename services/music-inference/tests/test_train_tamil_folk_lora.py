"""Tests for `scripts/train_tamil_folk_lora.py`.

The trainer reuses `_lora_trainer.build_dry_run_summary`; tests here
pin the Tamil-folk-specific style label and HF Hub push target.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import train_tamil_folk_lora as trainer  # noqa: E402
from _lora_trainer import build_dry_run_summary  # noqa: E402


def _write_corpus(tmp_path: Path) -> Path:
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    (corpus / "summary.json").write_text(
        json.dumps(
            {
                "clip_count": 18,
                "total_hours": 0.38,
                "by_license_seconds": {"cc-by": 1200.0, "cc-by-sa": 180.0},
                "by_source_clips": {"tnff": 12, "bl-sounds": 6},
                "splits": {
                    "train_clip_ids": [f"clip{i:02d}" for i in range(16)],
                    "eval_clip_ids": ["clip16", "clip17"],
                },
            }
        ),
        encoding="utf-8",
    )
    return corpus


def test_dry_run_exits_zero(tmp_path: Path) -> None:
    corpus = _write_corpus(tmp_path)
    argv = [
        "train_tamil_folk_lora.py",
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


def test_default_style_label_is_tamil_folk(tmp_path: Path) -> None:
    corpus = _write_corpus(tmp_path)
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
        style_family="tamil-folk",
    )
    summary = build_dry_run_summary(args)
    assert summary["style_family"] == "tamil-folk"
    assert summary["rank"] == 32
    assert summary["effective_batch"] == 32
    assert "q_proj" in summary["target_modules"]


def test_missing_corpus_fails(tmp_path: Path) -> None:
    args = argparse.Namespace(
        base_model="x",
        ckpt_dir=Path("/x"),
        corpus=tmp_path / "nope",
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
        style_family="tamil-folk",
    )
    with pytest.raises(SystemExit, match="summary.json"):
        build_dry_run_summary(args)


def test_default_hub_repo_documented() -> None:
    """The default HF Hub push target is documented in the module."""
    assert trainer.DEFAULT_HUB_REPO == "neo-fm/heartmula-tamil-folk-lora-v1"
