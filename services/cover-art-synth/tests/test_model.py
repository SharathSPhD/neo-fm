"""Unit tests for the cover-art model layer (Fake + env-driven boot)."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

from app import model as model_module
from app.model import CoverArtRequest, FakeCoverArtModel


@pytest.fixture(autouse=True)
def _reset_module_state() -> Iterator[None]:
    prior_env = {
        k: os.environ.get(k)
        for k in ("COVER_ART_BACKEND", "COVER_ART_MODEL_ID")
    }
    yield
    for k, v in prior_env.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    model_module.set_active_model(None)


def _req(prompt: str = "soft sunrise over a tabla", seed: int | None = 7) -> CoverArtRequest:
    return CoverArtRequest(
        job_id="00000000-0000-0000-0000-000000000001",
        attempt_id="11111111-1111-1111-1111-111111111111",
        trace_id="trace-1",
        prompt=prompt,
        style_family="hindustani",
        seed=seed,
        # Keep the test tiny so the pure-Python loop runs fast.
        width=64,
        height=64,
    )


def test_fake_model_renders_png_bytes() -> None:
    m = FakeCoverArtModel()
    out = m.synthesise(_req())
    assert m.backend == "fake"
    assert m.model_loaded is True
    assert out.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(out) > 100


def test_fake_model_is_deterministic_for_same_prompt_and_seed() -> None:
    m = FakeCoverArtModel()
    a = m.synthesise(_req(prompt="raag bhairav", seed=42))
    b = m.synthesise(_req(prompt="raag bhairav", seed=42))
    assert a == b


def test_fake_model_changes_with_prompt() -> None:
    m = FakeCoverArtModel()
    a = m.synthesise(_req(prompt="raag bhairav", seed=42))
    b = m.synthesise(_req(prompt="raag yaman", seed=42))
    assert a != b


def test_fake_model_changes_with_seed() -> None:
    m = FakeCoverArtModel()
    a = m.synthesise(_req(prompt="parai folk", seed=1))
    b = m.synthesise(_req(prompt="parai folk", seed=2))
    assert a != b


def test_initialise_from_env_fake_backend() -> None:
    os.environ["COVER_ART_BACKEND"] = "fake"
    model_module.set_active_model(None)
    model_module.initialise_from_env()
    m = model_module.get_active_model()
    assert m is not None
    assert m.backend == "fake"
    assert m.model_loaded is True


def test_initialise_from_env_unknown_backend_falls_back_to_fake() -> None:
    os.environ["COVER_ART_BACKEND"] = "not-a-real-backend"
    model_module.set_active_model(None)
    model_module.initialise_from_env()
    m = model_module.get_active_model()
    assert m is not None
    assert m.backend == "fake"


def test_initialise_from_env_z_image_falls_back_when_diffusers_missing() -> None:
    """In CI, torch+diffusers aren't installed; boot must still complete
    by falling back to the fake backend instead of crashing the
    container. The real `_DiffusersBackend.load` is tested separately
    on the DGX (out of CI scope)."""
    os.environ["COVER_ART_BACKEND"] = "z-image"
    model_module.set_active_model(None)
    model_module.initialise_from_env()
    m = model_module.get_active_model()
    assert m is not None
    assert m.backend == "fake"
