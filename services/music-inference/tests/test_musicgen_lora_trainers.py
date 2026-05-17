"""Tests for MusicGen LoRA training scripts (v1.4 Sprint 10).

CI exercises `--dry-run`; the real `_real_train` is operator-only on
DGX. We pin the trainer-config shape so any drift from the
documented recipe surfaces here rather than 18h into a GPU job.
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

import _musicgen_lora_trainer  # noqa: E402
import train_musicgen_carnatic_lora  # noqa: E402
import train_musicgen_hindustani_lora  # noqa: E402


def _seed_corpus(tmp_path: Path) -> Path:
    """Build a minimal `summary.json` so the trainer can read clip counts."""
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    (corpus / "summary.json").write_text(
        json.dumps(
            {
                "clip_count": 200,
                "total_hours": 12.5,
                "by_license_seconds": {"cc-by-nc-sa": 45000.0},
                "by_source_clips": {"saraga": 200},
                "splits": {
                    "train_clip_ids": [f"c{i:03d}" for i in range(180)],
                    "eval_clip_ids": [f"c{i:03d}" for i in range(180, 200)],
                },
            },
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    return corpus


def _build_args(
    *,
    corpus: Path,
    output_dir: Path,
    style_family: str,
    push_to_hub: str | None = None,
) -> argparse.Namespace:
    """Build a Namespace identical to what argparse produces."""
    return argparse.Namespace(
        corpus=corpus,
        output_dir=output_dir,
        style_family=style_family,
        push_to_hub=push_to_hub,
        base_model="facebook/musicgen-medium",
        rank=16,
        alpha=32,
        dropout=0.05,
        lr=1e-4,
        epochs=5,
        batch_size=8,
        grad_accum=4,
        bf16=True,
        target_modules=["q_proj", "k_proj", "v_proj", "out_proj"],
        trackio_project="neo-fm/musicgen-lora",
        dry_run=True,
        log_level="INFO",
    )


def test_carnatic_dry_run_summary(tmp_path: Path) -> None:
    corpus = _seed_corpus(tmp_path)
    args = _build_args(
        corpus=corpus,
        output_dir=tmp_path / "out",
        style_family="carnatic",
    )
    summary = train_musicgen_carnatic_lora._dry_run_summary(args)

    assert summary["engine"] == "musicgen"
    assert summary["style_family"] == "carnatic"
    assert summary["base_model"] == "facebook/musicgen-medium"
    assert summary["rank"] == 16
    assert summary["alpha"] == 32
    assert summary["train_clip_count"] == 180
    assert summary["eval_clip_count"] == 20
    assert summary["effective_batch"] == 32  # 8 * 4
    assert summary["target_modules"] == [
        "q_proj",
        "k_proj",
        "v_proj",
        "out_proj",
    ]


def test_hindustani_dry_run_summary(tmp_path: Path) -> None:
    corpus = _seed_corpus(tmp_path)
    args = _build_args(
        corpus=corpus,
        output_dir=tmp_path / "out",
        style_family="hindustani",
    )
    summary = train_musicgen_hindustani_lora._dry_run_summary(args)

    assert summary["style_family"] == "hindustani"
    assert summary["base_model"] == "facebook/musicgen-medium"
    assert summary["rank"] == 16


def test_default_hub_repos_match_adr_0030() -> None:
    """ADR 0030 pins the HF Hub repo names; the trainer constants must
    match so the operator running `--push-to-hub` lands the adapters
    where the runtime expects to find them.
    """
    assert (
        train_musicgen_carnatic_lora.DEFAULT_HUB_REPO
        == "neo-fm/musicgen-carnatic-lora-v1"
    )
    assert (
        train_musicgen_hindustani_lora.DEFAULT_HUB_REPO
        == "neo-fm/musicgen-hindustani-lora-v1"
    )


def test_missing_corpus_summary_raises(tmp_path: Path) -> None:
    args = _build_args(
        corpus=tmp_path / "missing",
        output_dir=tmp_path / "out",
        style_family="carnatic",
    )
    with pytest.raises(SystemExit, match=r"missing summary\.json"):
        _musicgen_lora_trainer.build_dry_run_summary(args)


def test_run_or_dry_emits_json(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    corpus = _seed_corpus(tmp_path)
    args = _build_args(
        corpus=corpus,
        output_dir=tmp_path / "out",
        style_family="carnatic",
    )
    rc = _musicgen_lora_trainer.run_or_dry(args)
    assert rc == 0
    out = capsys.readouterr().out
    parsed = json.loads(out)
    assert parsed["engine"] == "musicgen"
    assert parsed["style_family"] == "carnatic"
