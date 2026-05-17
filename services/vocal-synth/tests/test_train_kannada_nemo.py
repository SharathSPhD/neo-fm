"""Tests for `scripts/train_kannada_nemo.py` (v1.4 Sprint 13)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.curate_kannada_tts import make_synthetic_rows  # noqa: E402
from scripts.train_kannada_nemo import (  # noqa: E402
    DEFAULT_CONFIG,
    build_speaker_map,
    load_manifest,
    main,
    write_placeholder_artifacts,
)


def _write_manifest(path: Path, rows: list) -> None:
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(r.to_jsonl() + "\n")


def _run_main(argv: list[str]) -> int:
    saved = sys.argv[:]
    try:
        sys.argv = ["train_kannada_nemo.py", *argv]
        return main()
    finally:
        sys.argv = saved


def test_load_manifest_parses_curate_output(tmp_path: Path) -> None:
    manifest = tmp_path / "m.jsonl"
    _write_manifest(manifest, make_synthetic_rows())
    rows = load_manifest(manifest)
    assert len(rows) == 2
    assert rows[0]["speaker_id"] == 0


def test_load_manifest_rejects_empty_file(tmp_path: Path) -> None:
    manifest = tmp_path / "m.jsonl"
    manifest.write_text("", encoding="utf-8")
    with pytest.raises(ValueError, match="empty"):
        load_manifest(manifest)


def test_load_manifest_rejects_missing_field(tmp_path: Path) -> None:
    manifest = tmp_path / "m.jsonl"
    manifest.write_text(
        json.dumps({"audio_filepath": "x.wav", "duration": 2.0, "text": "hi"})
        + "\n",  # missing speaker_id
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="speaker_id"):
        load_manifest(manifest)


def test_load_manifest_rejects_bad_duration(tmp_path: Path) -> None:
    manifest = tmp_path / "m.jsonl"
    manifest.write_text(
        json.dumps(
            {
                "audio_filepath": "x.wav",
                "duration": 30.0,
                "text": "hi",
                "speaker_id": 0,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="outside"):
        load_manifest(manifest)


def test_build_speaker_map_pins_two_kannada_personas() -> None:
    sm = build_speaker_map([])
    # Sprint 13 contract: catalogue voice_id -> stable speaker int.
    assert sm == {
        "indic_kn_male_warm": 3,
        "indic_kn_female_bhajan": 4,
    }


def test_write_placeholder_artifacts_emits_three_files(tmp_path: Path) -> None:
    write_placeholder_artifacts(
        tmp_path,
        speaker_map={"indic_kn_male_warm": 3, "indic_kn_female_bhajan": 4},
    )
    for name in ("fastpitch.nemo", "hifigan.nemo", "speaker_map.json"):
        assert (tmp_path / name).exists(), f"missing {name}"
    # The training_config sidecar tracks Sprint 13's hyperparameters.
    cfg = json.loads(
        (tmp_path / "training_config.json").read_text(encoding="utf-8")
    )
    assert cfg["fastpitch_epochs"] == DEFAULT_CONFIG.fastpitch_epochs
    assert cfg["target_sample_rate"] == DEFAULT_CONFIG.target_sample_rate


def test_dry_run_validates_manifest_and_emits_artifacts(tmp_path: Path) -> None:
    manifest = tmp_path / "m.jsonl"
    _write_manifest(manifest, make_synthetic_rows())
    out_dir = tmp_path / "weights"
    rc = _run_main(
        [
            "--manifest",
            str(manifest),
            "--out-dir",
            str(out_dir),
            "--dry-run",
        ]
    )
    assert rc == 0
    assert (out_dir / "fastpitch.nemo").exists()
    assert (out_dir / "hifigan.nemo").exists()
    sm = json.loads(
        (out_dir / "speaker_map.json").read_text(encoding="utf-8")
    )
    assert sm["indic_kn_male_warm"] == 3


def test_real_mode_refuses_without_nemo_toolkit(tmp_path: Path) -> None:
    """Without --dry-run and without nemo_toolkit installed (CI),
    the script must error loudly rather than half-train."""
    pytest.importorskip("pytest")
    if _have_nemo():
        pytest.skip("nemo_toolkit is installed; real-mode test irrelevant")
    manifest = tmp_path / "m.jsonl"
    _write_manifest(manifest, make_synthetic_rows())
    out_dir = tmp_path / "weights"
    with pytest.raises(RuntimeError, match="nemo_toolkit"):
        _run_main(
            ["--manifest", str(manifest), "--out-dir", str(out_dir)]
        )


def _have_nemo() -> bool:
    try:
        import nemo  # type: ignore[import-not-found]  # noqa: F401
        return True
    except ImportError:
        return False
