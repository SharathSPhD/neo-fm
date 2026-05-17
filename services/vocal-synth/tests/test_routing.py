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


def test_pick_backend_routes_indicf5_voice_id_to_indicf5() -> None:
    """v1.4 Sprint 12: when a section carries a voice_id whose
    catalogue entry has ``backend == 'indicf5'``, the router must
    pick the ``indicf5`` arm — even if the language/script would
    otherwise pick `svara` or `parler`."""
    sec = VocalSection(
        id="s1",
        type="verse",
        lyrics="\u0928\u092e\u0938\u094d\u0915\u093e\u0930",  # नमस्कार
        language="hi",
        script="devanagari",
        transliteration=None,
        target_seconds=4,
        tempo_bpm=90,
        raga_name=None,
        voice_timbre="male",
        voice_id="indic_hi_male_broadcast",
    )
    key, reason = _pick_backend(sec)
    assert key == "indicf5"
    assert "indic_hi_male_broadcast" in reason


def test_pick_backend_routes_parler_voice_id_to_parler() -> None:
    """The 2 indic_kn_* personas stay on Parler in Sprint 12 (they
    move to NeMo in Sprint 13). Pin that contract."""
    sec = VocalSection(
        id="s1",
        type="verse",
        lyrics="\u0c95\u0ca8\u0ccd\u0ca8\u0ca1",  # ಕನ್ನಡ
        language="kn",
        script="kannada",
        transliteration=None,
        target_seconds=4,
        tempo_bpm=90,
        raga_name=None,
        voice_timbre="male",
        voice_id="indic_kn_male_warm",
    )
    key, _ = _pick_backend(sec)
    assert key == "parler"


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
        indicf5=_DeadModel(),  # type: ignore[arg-type]
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
        indicf5=_DeadModel(),  # type: ignore[arg-type]
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


def test_routing_model_dispatches_indicf5_when_voice_id_set() -> None:
    """v1.4 Sprint 12 end-to-end: a section carrying
    voice_id='indic_hi_male_broadcast' (which the catalogue maps
    to backend='indicf5') must be rendered by the IndicF5 backend,
    not Parler or Svara."""

    indicf5_calls: list[VocalRequest] = []
    other_calls: list[VocalRequest] = []

    class _IndicF5Spy:
        @property
        def model_loaded(self) -> bool:
            return True

        @property
        def model_version(self) -> str | None:
            return "indicf5-spy"

        def load(self) -> None:
            return None

        def synthesise(self, req: VocalRequest) -> bytes:
            indicf5_calls.append(req)
            return FakeVocalModel().synthesise(req)

    class _OtherSpy:
        @property
        def model_loaded(self) -> bool:
            return True

        @property
        def model_version(self) -> str | None:
            return "other-spy"

        def load(self) -> None:
            return None

        def synthesise(self, req: VocalRequest) -> bytes:
            other_calls.append(req)
            return FakeVocalModel().synthesise(req)

    rm = RoutingVocalModel(
        svara=_OtherSpy(),  # type: ignore[arg-type]
        parler=_OtherSpy(),  # type: ignore[arg-type]
        indicf5=_IndicF5Spy(),  # type: ignore[arg-type]
    )
    sec = VocalSection(
        id="s1",
        type="verse",
        lyrics="\u0928\u092e\u0938\u094d\u0915\u093e\u0930",  # नमस्कार
        language="hi",
        script="devanagari",
        transliteration=None,
        target_seconds=4,
        tempo_bpm=90,
        raga_name=None,
        voice_timbre="male",
        voice_id="indic_hi_male_broadcast",
    )
    req = VocalRequest(
        job_id="j",
        attempt_id=None,
        trace_id=None,
        language="hi",
        style_family="bollywood-ballad",
        voice_timbre="male",
        sample_rate=24000,
        sections=[sec],
        target_duration_seconds=4,
    )
    rm.synthesise(req)
    assert len(indicf5_calls) == 1, "IndicF5 spy was not invoked"
    assert other_calls == []
    decisions = rm.last_decisions
    assert decisions and decisions[0].backend == "indicf5"
    assert "indic_hi_male_broadcast" in decisions[0].reason


def test_routing_model_forwards_phonemes_into_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    """v1.3 Sprint 4: when the producer (co-composer) supplies phonemes,
    the router splices them into the backend's `transliteration` so the
    upstream tokeniser sees the canonical pronunciation, not the raw
    Devanagari surface form. Backends that ignore phonemes today still
    sing -- but the audible pronunciation regression we shipped in v1
    cannot reproduce against the new pipeline.
    """

    captured: list[VocalSection] = []

    class _SpyBackend:
        @property
        def model_loaded(self) -> bool:
            return True

        @property
        def model_version(self) -> str | None:
            return "spy"

        def load(self) -> None:
            return None

        def synthesise(self, req: VocalRequest) -> bytes:
            for s in req.sections:
                captured.append(s)
            # Return a deterministic stub WAV.
            return FakeVocalModel().synthesise(req)

    rm = RoutingVocalModel(
        svara=_SpyBackend(),  # type: ignore[arg-type]
        parler=_SpyBackend(),  # type: ignore[arg-type]
        indicf5=_SpyBackend(),  # type: ignore[arg-type]
    )
    sec = VocalSection(
        id="s1",
        type="mukhda",
        lyrics="\u0928\u092e\u0938\u094d\u0915\u093e\u0930",  # नमस्कार
        language="hi",
        script="devanagari",
        transliteration=None,
        target_seconds=4,
        tempo_bpm=90,
        raga_name=None,
        voice_timbre="androgynous",
        phonemes=("n", "a", "m", "a", "s", "k", "aa", "r"),
    )
    req = VocalRequest(
        job_id="j",
        attempt_id=None,
        trace_id=None,
        language="hi",
        style_family="hindustani",
        voice_timbre="androgynous",
        sample_rate=24000,
        sections=[sec],
        target_duration_seconds=4,
    )
    rm.synthesise(req)
    assert len(captured) == 1
    spliced = captured[0]
    assert spliced.script == "ipa"
    assert spliced.transliteration == "n a m a s k aa r"


def test_routing_model_falls_back_to_preprocessor_output_when_no_phonemes() -> None:
    """If phonemes are absent the router should still feed the prepared
    utterance text into the backend (the v1.2 'dead code' gap)."""

    captured: list[VocalSection] = []

    class _SpyBackend:
        @property
        def model_loaded(self) -> bool:
            return True

        @property
        def model_version(self) -> str | None:
            return "spy"

        def load(self) -> None:
            return None

        def synthesise(self, req: VocalRequest) -> bytes:
            for s in req.sections:
                captured.append(s)
            return FakeVocalModel().synthesise(req)

    rm = RoutingVocalModel(
        svara=_SpyBackend(),  # type: ignore[arg-type]
        parler=_SpyBackend(),  # type: ignore[arg-type]
        indicf5=_SpyBackend(),  # type: ignore[arg-type]
    )
    # Hinglish input (latin script, language=hi) routes to parler with
    # IPA hints from the preprocessor.
    sec = VocalSection(
        id="s1",
        type="verse",
        lyrics="aaja aaja",
        language="hi",
        script="latin",
        transliteration=None,
        target_seconds=4,
        tempo_bpm=90,
        raga_name=None,
        voice_timbre="androgynous",
    )
    req = VocalRequest(
        job_id="j",
        attempt_id=None,
        trace_id=None,
        language="hi",
        style_family="hindustani",
        voice_timbre="androgynous",
        sample_rate=24000,
        sections=[sec],
        target_duration_seconds=4,
    )
    rm.synthesise(req)
    assert len(captured) == 1
    # The preprocessor wraps Hinglish input in `[ipa:...]` so we know
    # something genuinely fed through.
    spliced = captured[0]
    assert spliced.transliteration is not None
    assert spliced.transliteration != sec.lyrics
    assert "ipa" in (spliced.script or "") or spliced.transliteration.startswith(
        "[ipa:"
    )
