from __future__ import annotations

import struct

import pytest

from app.model import FakeVocalModel, VocalRequest, VocalSection
from app.routing import RoutingVocalModel, _pick_backend


def _section(
    *,
    type_: str = "verse",
    lyrics: str | None = "ho ri",
    transliteration: str | None = None,
    language: str = "hi",
    script: str | None = "devanagari",
    target_seconds: int = 4,
) -> VocalSection:
    return VocalSection(
        id="s1",
        type=type_,
        lyrics=lyrics,
        language=language,
        script=script,
        transliteration=transliteration,
        target_seconds=target_seconds,
        tempo_bpm=90,
        raga_name=None,
        voice_timbre="androgynous",
    )


def test_pick_backend_instrumental_uses_fake() -> None:
    key, _ = _pick_backend(_section(type_="instrumental", lyrics=None))
    assert key == "fake"


def test_pick_backend_english_uses_parler() -> None:
    key, _ = _pick_backend(
        _section(language="en", script="latin", lyrics="hello world")
    )
    assert key == "parler"


def test_pick_backend_latin_hindi_uses_parler() -> None:
    key, reason = _pick_backend(
        _section(language="hi", script="latin", lyrics="aaja aaja")
    )
    assert key == "parler"
    assert reason == "latin-script-indic"


def test_pick_backend_devanagari_uses_svara() -> None:
    key, _ = _pick_backend(
        _section(language="hi", script="devanagari", lyrics="\u0906\u091c")
    )
    assert key == "svara"


def test_pick_backend_kannada_uses_svara() -> None:
    key, _ = _pick_backend(
        _section(language="kn", script="kannada", lyrics="\u0c95\u0ca8\u0ccd")
    )
    assert key == "svara"


def _wav_data_seconds(buf: bytes, sample_rate: int) -> float:
    assert buf[:4] == b"RIFF"
    assert buf[8:12] == b"WAVE"
    data_size = struct.unpack("<I", buf[40:44])[0]
    samples = data_size // 2
    return samples / sample_rate


def test_routing_model_falls_back_to_fake_when_real_backends_missing() -> None:
    fb = FakeVocalModel()
    # Stub backends that always fail to load -> route falls back to fb.
    class _DeadModel:
        @property
        def model_loaded(self) -> bool:
            return False

        @property
        def model_version(self) -> str | None:
            return None

        def load(self) -> None:
            raise RuntimeError("not available")

        def synthesise(self, _req: VocalRequest) -> bytes:  # pragma: no cover
            raise AssertionError("should not be called")

    rm = RoutingVocalModel(
        svara=_DeadModel(),  # type: ignore[arg-type]
        parler=_DeadModel(),  # type: ignore[arg-type]
        fallback=fb,
    )
    req = VocalRequest(
        job_id="j",
        attempt_id=None,
        trace_id=None,
        language="hi",
        style_family="hindustani",
        voice_timbre="androgynous",
        sample_rate=24000,
        sections=[_section(), _section(language="en", script="latin", lyrics="hi")],
        target_duration_seconds=8,
    )
    out = rm.synthesise(req)
    assert isinstance(out, bytes)
    assert abs(_wav_data_seconds(out, 24000) - 8.0) < 0.01
    decisions = rm.last_decisions
    assert len(decisions) == 2
    assert {d.backend for d in decisions} <= {"svara", "parler", "fake"}


def test_routing_model_refuses_to_silently_fallback_when_required(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("NEO_FM_REQUIRE_REAL_MODEL", "1")

    class _DeadModel:
        @property
        def model_loaded(self) -> bool:
            return False

        @property
        def model_version(self) -> str | None:
            return None

        def load(self) -> None:
            raise RuntimeError("not available")

        def synthesise(self, _req: VocalRequest) -> bytes:  # pragma: no cover
            raise AssertionError("should not be called")

    rm = RoutingVocalModel(
        svara=_DeadModel(),  # type: ignore[arg-type]
        parler=_DeadModel(),  # type: ignore[arg-type]
    )
    req = VocalRequest(
        job_id="j",
        attempt_id=None,
        trace_id=None,
        language="hi",
        style_family="hindustani",
        voice_timbre="androgynous",
        sample_rate=24000,
        sections=[_section()],
        target_duration_seconds=4,
    )
    with pytest.raises(RuntimeError):
        rm.synthesise(req)
