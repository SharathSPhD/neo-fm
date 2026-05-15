from __future__ import annotations

import struct

import pytest

from app.model import FakeVocalModel, VocalRequest, VocalSection


def _wav_data_seconds(buf: bytes, sample_rate: int) -> float:
    # WAV header is 44 bytes for a canonical PCM-16 mono file.
    assert buf[:4] == b"RIFF"
    assert buf[8:12] == b"WAVE"
    data_size = struct.unpack("<I", buf[40:44])[0]
    # mono 16-bit PCM -> 2 bytes per sample
    samples = data_size // 2
    return samples / sample_rate


def _section(seconds: int, type_: str = "verse", lyrics: str | None = "ho ri") -> VocalSection:
    return VocalSection(
        id="s",
        type=type_,
        lyrics=lyrics,
        language="hi",
        script="devanagari",
        transliteration=None,
        target_seconds=seconds,
        tempo_bpm=90,
        raga_name="Yaman",
        voice_timbre="androgynous",
    )


@pytest.mark.parametrize("sr", [22050, 24000, 48000])
def test_fake_model_emits_wav_of_target_duration(sr: int) -> None:
    m = FakeVocalModel()
    req = VocalRequest(
        job_id="j",
        attempt_id=None,
        trace_id=None,
        language="hi",
        style_family="hindustani",
        voice_timbre="androgynous",
        sample_rate=sr,
        sections=[_section(3), _section(2, type_="chorus", lyrics="aaj")],
        target_duration_seconds=5,
    )
    out = m.synthesise(req)
    assert isinstance(out, bytes)
    duration = _wav_data_seconds(out, sr)
    assert abs(duration - 5.0) < 0.01
    # Sanity: not all zeros.
    assert any(b != 0 for b in out[44:200])


def test_instrumental_sections_get_quiet() -> None:
    m = FakeVocalModel()
    req = VocalRequest(
        job_id="j",
        attempt_id=None,
        trace_id=None,
        language="hi",
        style_family="hindustani",
        voice_timbre="male",
        sample_rate=24000,
        sections=[_section(2, type_="instrumental", lyrics=None)],
        target_duration_seconds=2,
    )
    out = m.synthesise(req)
    # parse 16-bit PCM
    pcm = out[44:]
    import struct as _s

    samples = _s.unpack(f"<{len(pcm)//2}h", pcm)
    peak = max(abs(s) for s in samples)
    assert peak < 6000  # instrumental scaled to 5% of vocal amplitude


def test_fake_model_refuses_when_real_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEO_FM_REQUIRE_REAL_MODEL", "1")
    with pytest.raises(RuntimeError, match="FakeVocalModel refused"):
        FakeVocalModel()


def test_fake_model_pads_short_sections() -> None:
    m = FakeVocalModel()
    # request 4s total but sections sum to 2s -> should pad with silence.
    req = VocalRequest(
        job_id="j",
        attempt_id=None,
        trace_id=None,
        language="kn",
        style_family="kannada-folk",
        voice_timbre="female",
        sample_rate=24000,
        sections=[_section(2)],
        target_duration_seconds=4,
    )
    out = m.synthesise(req)
    assert abs(_wav_data_seconds(out, 24000) - 4.0) < 0.01
