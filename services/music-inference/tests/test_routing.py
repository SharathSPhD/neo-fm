"""Tests for `app/routing.py` — v1.4 Sprint 10 A/B router.

Pins the default route table against the plan §10 spec, plus the env
override behaviour. Uses two `FakeMusicModel`s tagged with their
engine so we can prove the right backend received each request.
"""

from __future__ import annotations

import io
import wave
from dataclasses import dataclass

import pytest

from app.model import GenerationRequest, GenerationSection
from app.routing import RoutingMusicModel, resolve_engine


@dataclass
class FakeBackend:
    """A `MusicModel` that records the request it saw and returns a
    tagged silent WAV so tests can verify which backend served the
    call."""

    name: str
    loaded: bool = True
    calls: int = 0

    @property
    def model_loaded(self) -> bool:
        return self.loaded

    @property
    def model_version(self) -> str | None:
        return f"{self.name}-fake-1.0" if self.loaded else None

    def generate(self, req: GenerationRequest) -> bytes:
        del req  # the fake doesn't care about the request body
        self.calls += 1
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(48000)
            w.writeframes(b"\x00\x00" * 4)
        return buf.getvalue()


def _req(style_family: str) -> GenerationRequest:
    return GenerationRequest(
        job_id="job-123",
        attempt_id=None,
        style_family=style_family,
        target_duration_seconds=30,
        sections=[GenerationSection(id="s1", type="verse", target_seconds=30)],
    )


def test_resolve_carnatic_default_routes_to_musicgen() -> None:
    assert resolve_engine("carnatic", env={}) == "musicgen"


def test_resolve_hindustani_default_routes_to_musicgen() -> None:
    assert resolve_engine("hindustani", env={}) == "musicgen"


def test_resolve_bhavageete_defaults_to_heartmula() -> None:
    """Sprint 8's bhavageete LoRA lives on HeartMuLa; the router must
    not steal it onto MusicGen."""
    assert resolve_engine("kannada-light-classical", env={}) == "heartmula"


def test_resolve_tamil_folk_defaults_to_heartmula() -> None:
    """Sprint 9 Tamil-folk also lives on HeartMuLa."""
    assert resolve_engine("tamil-folk", env={}) == "heartmula"


def test_resolve_unknown_style_falls_back_to_heartmula() -> None:
    """Typo or future style shouldn't 500; HeartMuLa is the safety net."""
    assert resolve_engine("not-a-real-style", env={}) == "heartmula"


def test_env_override_forces_carnatic_onto_heartmula() -> None:
    env = {"MUSIC_ENGINE_CARNATIC": "heartmula"}
    assert resolve_engine("carnatic", env=env) == "heartmula"


def test_env_override_forces_kannada_onto_musicgen() -> None:
    env = {"MUSIC_ENGINE_KANNADA_LIGHT_CLASSICAL": "musicgen"}
    assert resolve_engine("kannada-light-classical", env=env) == "musicgen"


def test_env_override_with_garbage_falls_back_to_default() -> None:
    env = {"MUSIC_ENGINE_CARNATIC": "potato"}
    assert resolve_engine("carnatic", env=env) == "musicgen"


def test_routing_dispatches_carnatic_to_musicgen_backend() -> None:
    h = FakeBackend("heartmula")
    m = FakeBackend("musicgen")
    router = RoutingMusicModel(heartmula=h, musicgen=m)
    router.generate(_req("carnatic"))
    assert m.calls == 1
    assert h.calls == 0


def test_routing_dispatches_bhavageete_to_heartmula_backend() -> None:
    h = FakeBackend("heartmula")
    m = FakeBackend("musicgen")
    router = RoutingMusicModel(heartmula=h, musicgen=m)
    router.generate(_req("kannada-light-classical"))
    assert h.calls == 1
    assert m.calls == 0


def test_routing_falls_back_when_primary_unloaded() -> None:
    """If the primary backend hasn't loaded its weights yet, the
    router routes to the secondary and logs `route_fallback`."""
    h = FakeBackend("heartmula", loaded=True)
    m = FakeBackend("musicgen", loaded=False)
    router = RoutingMusicModel(heartmula=h, musicgen=m)
    # Carnatic normally goes to MusicGen; with MusicGen unloaded, it
    # falls back to HeartMuLa rather than 500.
    router.generate(_req("carnatic"))
    assert h.calls == 1
    assert m.calls == 0


def test_routing_raises_when_both_unloaded() -> None:
    h = FakeBackend("heartmula", loaded=False)
    m = FakeBackend("musicgen", loaded=False)
    router = RoutingMusicModel(heartmula=h, musicgen=m)
    with pytest.raises(RuntimeError, match=r"neither"):
        router.generate(_req("carnatic"))


def test_routing_model_loaded_true_when_either_loaded() -> None:
    h = FakeBackend("heartmula", loaded=True)
    m = FakeBackend("musicgen", loaded=False)
    router = RoutingMusicModel(heartmula=h, musicgen=m)
    assert router.model_loaded is True


def test_routing_model_version_combines_both() -> None:
    h = FakeBackend("heartmula")
    m = FakeBackend("musicgen")
    router = RoutingMusicModel(heartmula=h, musicgen=m)
    v = router.model_version
    assert v is not None
    assert "heartmula" in v
    assert "musicgen" in v
