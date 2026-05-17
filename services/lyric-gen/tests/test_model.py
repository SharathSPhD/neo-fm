"""Unit tests for the lyric-gen model layer (Fake + env-driven boot)."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

from app import model as model_module
from app.model import (
    FakeLyricGenModel,
    LyricGenRequest,
    LyricGenSection,
)


@pytest.fixture(autouse=True)
def _reset_module_state() -> Iterator[None]:
    keys = (
        "LYRIC_GEN_BACKEND",
        "LYRIC_GEN_MODEL_ID",
        "LYRIC_GEN_MODEL_DIR",
        "LYRIC_GEN_HF_ADAPTER",
    )
    prior_env = {k: os.environ.get(k) for k in keys}
    yield
    for k, v in prior_env.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    model_module.set_active_model(None)


def _req(
    *,
    language: str = "hi",
    style: str = "hindustani",
    seed: int | None = 7,
    sections: list[LyricGenSection] | None = None,
) -> LyricGenRequest:
    return LyricGenRequest(
        job_id="00000000-0000-0000-0000-000000000001",
        attempt_id="11111111-1111-1111-1111-111111111111",
        trace_id="trace-1",
        language=language,  # type: ignore[arg-type]
        style_family=style,  # type: ignore[arg-type]
        mood="devotional",
        prompt="a short lyric about dawn and the river",
        raga_name="bhairav",
        seed=seed,
        sections=sections
        or [
            LyricGenSection(
                section_id="mukhda-1",
                section_type="mukhda",
                target_syllables=12,
            ),
        ],
    )


def test_fake_model_renders_a_lyric_response() -> None:
    m = FakeLyricGenModel()
    resp = m.generate(_req())
    assert m.backend == "fake"
    assert m.model_loaded is True
    assert resp.backend == "fake"
    assert resp.body.strip() != ""
    assert len(resp.sections) == 1
    assert resp.sections[0].section_id == "mukhda-1"


def test_fake_model_is_deterministic_for_same_seed() -> None:
    m = FakeLyricGenModel()
    a = m.generate(_req(seed=42))
    b = m.generate(_req(seed=42))
    assert a.body == b.body


def test_fake_model_changes_with_style() -> None:
    m = FakeLyricGenModel()
    a = m.generate(_req(style="hindustani", seed=1))
    b = m.generate(_req(style="carnatic", seed=1))
    assert a.body != b.body


def test_fake_model_emits_one_section_per_requested_section() -> None:
    m = FakeLyricGenModel()
    resp = m.generate(
        _req(
            sections=[
                LyricGenSection(
                    section_id="pallavi-1",
                    section_type="pallavi",
                    target_syllables=16,
                ),
                LyricGenSection(
                    section_id="charanam-1",
                    section_type="charanam",
                    target_syllables=24,
                ),
            ]
        )
    )
    assert [s.section_id for s in resp.sections] == ["pallavi-1", "charanam-1"]


def test_initialise_from_env_fake_backend() -> None:
    os.environ["LYRIC_GEN_BACKEND"] = "fake"
    model_module.set_active_model(None)
    model_module.initialise_from_env()
    m = model_module.get_active_model()
    assert m is not None
    assert m.backend == "fake"
    assert m.model_loaded is True


def test_initialise_from_env_unknown_backend_falls_back_to_fake() -> None:
    os.environ["LYRIC_GEN_BACKEND"] = "ridiculous"
    model_module.set_active_model(None)
    model_module.initialise_from_env()
    m = model_module.get_active_model()
    assert m is not None
    assert m.backend == "fake"


def test_initialise_from_env_indicbart_without_torch_falls_back() -> None:
    # CI doesn't have torch/transformers installed; the indicbart code
    # path should swallow the ImportError and fall back to fake instead
    # of crashing the container at boot.
    os.environ["LYRIC_GEN_BACKEND"] = "indicbart"
    model_module.set_active_model(None)
    model_module.initialise_from_env()
    m = model_module.get_active_model()
    assert m is not None
    assert m.backend == "fake"
