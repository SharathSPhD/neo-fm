"""Tests for scripts/train_chant_style_lora.py (Sprint 14)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.curate_sanskrit_chant import main as curate_main  # noqa: E402
from scripts.train_chant_style_lora import (  # noqa: E402
    DEFAULT_LORA_CONFIG,
    build_svara_calibration,
    load_manifest,
)
from scripts.train_chant_style_lora import main as train_main  # noqa: E402


def _run(fn, argv: list[str]) -> int:
    saved = sys.argv[:]
    try:
        sys.argv = [fn.__module__.split(".")[-1] + ".py", *argv]
        return fn()
    finally:
        sys.argv = saved


def _materialise_manifest(tmp_path: Path) -> Path:
    out = tmp_path / "chant.jsonl"
    rc = _run(curate_main, ["--out", str(out), "--dry-run"])
    assert rc == 0
    assert out.is_file()
    return out


def test_dry_run_emits_lora_artefacts(tmp_path: Path) -> None:
    manifest = _materialise_manifest(tmp_path)
    out_dir = tmp_path / "adapter"
    rc = _run(
        train_main,
        ["--manifest", str(manifest), "--out-dir", str(out_dir), "--dry-run"],
    )
    assert rc == 0
    assert (out_dir / "chant_style_lora.safetensors").is_file()
    assert (out_dir / "adapter_config.json").is_file()
    assert (out_dir / "svara_calibration.json").is_file()
    cfg = json.loads((out_dir / "adapter_config.json").read_text(encoding="utf-8"))
    assert cfg["adapter_id"] == "neo-fm/chant-style-v1"
    assert cfg["rank"] == 16
    assert cfg["base_model"] == "indicf5"


def test_dry_run_respects_base_nemo(tmp_path: Path) -> None:
    manifest = _materialise_manifest(tmp_path)
    out_dir = tmp_path / "adapter_nemo"
    rc = _run(
        train_main,
        [
            "--manifest",
            str(manifest),
            "--out-dir",
            str(out_dir),
            "--base",
            "nemo",
            "--dry-run",
        ],
    )
    assert rc == 0
    cfg = json.loads((out_dir / "adapter_config.json").read_text(encoding="utf-8"))
    assert cfg["base_model"] == "nemo"


def test_dry_run_writes_calibration_with_three_svara_keys(tmp_path: Path) -> None:
    manifest = _materialise_manifest(tmp_path)
    out_dir = tmp_path / "adapter_cal"
    rc = _run(
        train_main,
        ["--manifest", str(manifest), "--out-dir", str(out_dir), "--dry-run"],
    )
    assert rc == 0
    cal = json.loads(
        (out_dir / "svara_calibration.json").read_text(encoding="utf-8")
    )
    assert set(cal) == {"udatta", "anudatta", "svarita"}
    assert all(v >= 0 for v in cal.values())


def test_load_manifest_rejects_missing_svara_marks(tmp_path: Path) -> None:
    path = tmp_path / "bad.jsonl"
    path.write_text(
        json.dumps(
            {
                "audio_filepath": "/tmp/x.wav",
                "duration": 4.0,
                "text": "\u0950",
                "speaker_id": 0,
                "mantra_id": "x",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="svara_marks"):
        load_manifest(path)


def test_load_manifest_rejects_unknown_svara(tmp_path: Path) -> None:
    path = tmp_path / "bad.jsonl"
    path.write_text(
        json.dumps(
            {
                "audio_filepath": "/tmp/x.wav",
                "duration": 4.0,
                "text": "\u0950",
                "speaker_id": 0,
                "mantra_id": "x",
                "svara_marks": [
                    {"syllable_index": 0, "svara": "swarita", "duration_s": 0.5},
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"invalid svara"):
        load_manifest(path)


def test_load_manifest_rejects_duplicate_syllable_index(tmp_path: Path) -> None:
    path = tmp_path / "bad.jsonl"
    path.write_text(
        json.dumps(
            {
                "audio_filepath": "/tmp/x.wav",
                "duration": 4.0,
                "text": "\u0950",
                "speaker_id": 0,
                "mantra_id": "x",
                "svara_marks": [
                    {"syllable_index": 0, "svara": "udatta", "duration_s": 0.5},
                    {"syllable_index": 0, "svara": "anudatta", "duration_s": 0.3},
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="duplicate syllable_index"):
        load_manifest(path)


def test_build_svara_calibration_returns_medians() -> None:
    rows = [
        {
            "audio_filepath": "/tmp/a.wav",
            "duration": 4.0,
            "text": "\u0950",
            "speaker_id": 0,
            "mantra_id": "a",
            "svara_marks": [
                {"syllable_index": 0, "svara": "udatta", "duration_s": 1.0},
                {"syllable_index": 1, "svara": "udatta", "duration_s": 1.4},
                {"syllable_index": 2, "svara": "udatta", "duration_s": 1.8},
                {"syllable_index": 3, "svara": "anudatta", "duration_s": 0.3},
                {"syllable_index": 4, "svara": "svarita", "duration_s": 0.6},
            ],
        },
    ]
    cal = build_svara_calibration(rows)
    assert cal["udatta"] == pytest.approx(1.4)
    assert cal["anudatta"] == pytest.approx(0.3)
    assert cal["svarita"] == pytest.approx(0.6)


def test_default_lora_config_matches_plan() -> None:
    cfg = DEFAULT_LORA_CONFIG
    assert cfg.rank == 16
    assert cfg.alpha == 32
    assert cfg.epochs >= 1
    assert cfg.target_modules


def test_real_mode_refuses_in_ci(tmp_path: Path) -> None:
    manifest = _materialise_manifest(tmp_path)
    out_dir = tmp_path / "adapter_no_dry_run"
    rc = _run(
        train_main,
        ["--manifest", str(manifest), "--out-dir", str(out_dir)],
    )
    assert rc == 1
    assert not out_dir.exists()
