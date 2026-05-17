"""Unit tests for the Sanskrit chant-style adapter (Sprint 14)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from app.chant_style import (
    CHANT_SECTION_TYPES,
    CHANT_VOICE_IDS,
    ChantStyleSpec,
    apply_chant_prosody,
    load_chant_spec,
    should_use_chant_style,
)


def _write_artefacts(
    out_dir: Path,
    *,
    base_model: str = "indicf5",
    calibration: dict[str, float] | None = None,
    write_lora: bool = True,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "adapter_config.json").write_text(
        json.dumps(
            {
                "base_model": base_model,
                "adapter_id": "neo-fm/chant-style-v1",
                "rank": 16,
            }
        ),
        encoding="utf-8",
    )
    cal = calibration if calibration is not None else {
        "udatta": 1.20,
        "anudatta": 0.35,
        "svarita": 0.60,
    }
    (out_dir / "svara_calibration.json").write_text(
        json.dumps(cal), encoding="utf-8"
    )
    if write_lora:
        (out_dir / "chant_style_lora.safetensors").write_bytes(b"\x00")


def test_chant_voice_ids_match_catalog_personas() -> None:
    assert CHANT_VOICE_IDS == frozenset({"chant_sustained", "chant_devotional"})


def test_chant_section_types_match_schema() -> None:
    assert CHANT_SECTION_TYPES == frozenset({
        "shloka_verse",
        "shloka_refrain",
        "phalashruti",
    })


def test_should_use_chant_style_voice_id_wins(tmp_path: Path) -> None:
    use, reason = should_use_chant_style(
        style_family="western",
        section_type="verse",
        voice_id="chant_sustained",
    )
    assert use is True
    assert reason == "voice_id:chant_sustained"


def test_should_use_chant_style_picks_style_family() -> None:
    use, reason = should_use_chant_style(
        style_family="sanskrit-shloka",
        section_type="verse",
        voice_id=None,
    )
    assert use is True
    assert reason == "style:sanskrit-shloka"


def test_should_use_chant_style_picks_section_type() -> None:
    use, reason = should_use_chant_style(
        style_family="western",
        section_type="shloka_verse",
        voice_id=None,
    )
    assert use is True
    assert reason == "section_type:shloka_verse"


def test_should_use_chant_style_declines_when_nothing_matches() -> None:
    use, reason = should_use_chant_style(
        style_family="western",
        section_type="verse",
        voice_id=None,
    )
    assert use is False
    assert reason == "non-chant"


def test_load_chant_spec_falls_back_to_empty_when_no_artefacts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("VOCAL_CHANT_LORA_DIR", raising=False)
    spec = load_chant_spec(artefact_dir=tmp_path / "missing")
    assert spec.loaded is False
    assert spec.base_model == "indicf5"
    assert spec.adapter_id == "neo-fm/chant-style-v1"
    assert spec.rank == 16
    assert spec.svara_calibration == {"udatta": 0.0, "anudatta": 0.0, "svarita": 0.0}


def test_load_chant_spec_reads_full_artefact_set(tmp_path: Path) -> None:
    _write_artefacts(tmp_path)
    spec = load_chant_spec(artefact_dir=tmp_path)
    assert spec.loaded is True
    assert spec.base_model == "indicf5"
    assert spec.rank == 16
    assert spec.svara_calibration == {
        "udatta": 1.20,
        "anudatta": 0.35,
        "svarita": 0.60,
    }


def test_load_chant_spec_reads_env_when_arg_omitted(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_artefacts(tmp_path, base_model="nemo")
    monkeypatch.setenv("VOCAL_CHANT_LORA_DIR", str(tmp_path))
    spec = load_chant_spec()
    assert spec.loaded is True
    assert spec.base_model == "nemo"


def test_load_chant_spec_loaded_false_when_lora_missing(tmp_path: Path) -> None:
    _write_artefacts(tmp_path, write_lora=False)
    spec = load_chant_spec(artefact_dir=tmp_path)
    assert spec.loaded is False
    assert spec.base_model == "indicf5"


def test_apply_chant_prosody_preserves_length_and_peak() -> None:
    rng = np.random.default_rng(0)
    audio = rng.standard_normal(48000).astype(np.float32) * 0.4
    spec = ChantStyleSpec(
        base_model="indicf5",
        adapter_id="neo-fm/chant-style-v1",
        rank=16,
        lora_path=None,
        svara_calibration={"udatta": 0.5, "anudatta": 0.2, "svarita": 0.3},
    )
    out = apply_chant_prosody(audio, spec=spec, sample_rate=48000)
    assert out.shape == audio.shape
    assert float(np.max(np.abs(out))) <= float(np.max(np.abs(audio))) + 1e-6


def test_apply_chant_prosody_is_deterministic() -> None:
    audio = np.linspace(-0.5, 0.5, 24000, dtype=np.float32)
    spec = ChantStyleSpec(
        base_model="indicf5",
        adapter_id="neo-fm/chant-style-v1",
        rank=16,
        lora_path=None,
        svara_calibration={"udatta": 0.4, "anudatta": 0.2, "svarita": 0.3},
    )
    a = apply_chant_prosody(audio, spec=spec, sample_rate=48000)
    b = apply_chant_prosody(audio, spec=spec, sample_rate=48000)
    assert np.array_equal(a, b)


def test_apply_chant_prosody_handles_empty_audio() -> None:
    spec = ChantStyleSpec(
        base_model="indicf5",
        adapter_id="neo-fm/chant-style-v1",
        rank=16,
        lora_path=None,
        svara_calibration={"udatta": 0.5, "anudatta": 0.2, "svarita": 0.3},
    )
    out = apply_chant_prosody(np.zeros(0, dtype=np.float32), spec=spec, sample_rate=48000)
    assert out.shape == (0,)


def test_apply_chant_prosody_uses_default_window_when_udatta_zero() -> None:
    audio = np.ones(48000, dtype=np.float32) * 0.5
    spec = ChantStyleSpec(
        base_model="indicf5",
        adapter_id="neo-fm/chant-style-v1",
        rank=16,
        lora_path=None,
        svara_calibration={"udatta": 0.0, "anudatta": 0.0, "svarita": 0.0},
    )
    out = apply_chant_prosody(audio, spec=spec, sample_rate=48000)
    assert out.shape == audio.shape
    assert float(np.max(np.abs(out))) <= 0.5 + 1e-6
