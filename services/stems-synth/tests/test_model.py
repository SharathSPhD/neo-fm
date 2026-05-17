"""Tests for the stems-synth model layer (v1.4 Sprint 11)."""

from __future__ import annotations

import os
import wave
from io import BytesIO
from unittest import mock

import pytest

from app.model import (
    STEM_PRESETS,
    FakeStemModel,
    StemRequest,
    initialise_from_env,
    preset_applies_to_style,
    resolve_prompt,
)


def _decode_wav_meta(buf: bytes) -> tuple[int, int, int]:
    with wave.open(BytesIO(buf), "rb") as w:
        return w.getnchannels(), w.getframerate(), w.getnframes()


def test_presets_table_includes_required_v14_entries() -> None:
    """Sprint 11 plan §11 calls out tabla rolls, mridangam tihais,
    parai breaks, tanpura drones. The preset library must include all
    four families so the worker can pick a stem for any v1.4 style."""
    required = {
        "tabla_tihai",
        "mridangam_korvai",
        "parai_break",
        "tanpura_drone",
    }
    assert required.issubset(STEM_PRESETS.keys())


def test_each_preset_carries_prompt_duration_and_styles() -> None:
    for name, entry in STEM_PRESETS.items():
        assert "prompt" in entry and isinstance(entry["prompt"], str), name
        assert "duration_seconds" in entry, name
        assert 1.0 <= float(entry["duration_seconds"]) <= 12.0, name
        assert "style_families" in entry, name
        assert isinstance(entry["style_families"], list), name
        assert entry["style_families"], name  # not empty


def test_resolve_prompt_uses_preset_text_and_duration() -> None:
    text, dur = resolve_prompt(
        preset="tabla_tihai", prompt=None, style_family="hindustani"
    )
    assert "tabla" in text.lower()
    assert dur == STEM_PRESETS["tabla_tihai"]["duration_seconds"]


def test_resolve_prompt_uses_free_text_with_default_duration() -> None:
    text, dur = resolve_prompt(
        preset=None, prompt="custom tabla loop", style_family="hindustani"
    )
    assert text == "custom tabla loop"
    assert dur == 6.0


def test_resolve_prompt_rejects_empty_prompt() -> None:
    with pytest.raises(ValueError, match=r"non-empty"):
        resolve_prompt(preset=None, prompt="   ", style_family="hindustani")


def test_resolve_prompt_rejects_unknown_preset() -> None:
    with pytest.raises(ValueError, match=r"Unknown stem preset"):
        resolve_prompt(
            preset="not-a-thing", prompt=None, style_family="hindustani"
        )


def test_resolve_prompt_requires_one_of() -> None:
    with pytest.raises(ValueError, match=r"preset or prompt"):
        resolve_prompt(preset=None, prompt=None, style_family="hindustani")


def test_preset_applies_to_style_matches_published_table() -> None:
    assert preset_applies_to_style("tabla_tihai", "hindustani")
    assert not preset_applies_to_style("tabla_tihai", "tamil-folk")
    assert preset_applies_to_style("parai_break", "tamil-folk")
    assert not preset_applies_to_style("parai_break", "carnatic")
    assert preset_applies_to_style("mridangam_korvai", "carnatic")
    assert preset_applies_to_style("tanpura_drone", "sanskrit-shloka")
    assert not preset_applies_to_style("unknown", "carnatic")


def test_fake_model_generate_returns_44k_wav_at_preset_duration() -> None:
    m = FakeStemModel()
    req = StemRequest(
        job_id="job-1",
        attempt_id=None,
        style_family="hindustani",
        preset="tabla_tihai",
        prompt=None,
        duration_seconds=6.0,
    )
    resp = m.generate(req)
    channels, sr, frames = _decode_wav_meta(resp.audio)
    assert channels == 1
    assert sr == 44100
    # Fake model honours the resolved preset duration (6.0s).
    assert abs(frames - int(6.0 * 44100)) < 100
    assert resp.backend == "fake"
    assert resp.duration_seconds == 6.0
    # Records the request + resolved prompt so tests can poke at it.
    assert m.last_prompt == STEM_PRESETS["tabla_tihai"]["prompt"]


def test_fake_model_clamps_duration_to_request() -> None:
    """Request overrides the preset duration when explicit."""
    m = FakeStemModel()
    req = StemRequest(
        job_id="job-2",
        attempt_id=None,
        style_family="carnatic",
        preset="mridangam_korvai",
        prompt=None,
        duration_seconds=4.0,
    )
    resp = m.generate(req)
    assert resp.duration_seconds == 4.0


def test_fake_model_accepts_free_prompt() -> None:
    m = FakeStemModel()
    req = StemRequest(
        job_id="job-3",
        attempt_id=None,
        style_family="bollywood-ballad",
        preset=None,
        prompt="dholak break, fast",
        duration_seconds=5.0,
    )
    resp = m.generate(req)
    assert resp.duration_seconds == 5.0
    assert m.last_prompt == "dholak break, fast"


def test_initialise_from_env_refuses_fake_without_allow_flag() -> None:
    """Same safety belt as music-inference: a stray
    STEMS_SYNTH_FAKE_MODEL must not silently ship silence."""
    env = {"STEMS_SYNTH_FAKE_MODEL": "1"}
    # Clear ALLOW_FAKE if present in the dev shell so we hit the
    # negative branch deterministically.
    with mock.patch.dict(os.environ, env, clear=False):
        os.environ.pop("STEMS_SYNTH_ALLOW_FAKE", None)
        with pytest.raises(RuntimeError, match=r"ALLOW_FAKE"):
            initialise_from_env()


def test_initialise_from_env_installs_fake_with_both_flags() -> None:
    env = {
        "STEMS_SYNTH_FAKE_MODEL": "1",
        "STEMS_SYNTH_ALLOW_FAKE": "1",
    }
    with mock.patch.dict(os.environ, env, clear=False):
        m = initialise_from_env()
    assert isinstance(m, FakeStemModel)
    assert m.model_loaded is True
    assert m.backend == "fake"
