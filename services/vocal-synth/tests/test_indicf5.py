"""Tests for `app/indicf5.py` (v1.4 Sprint 12).

We do NOT exercise the real model — IndicF5 is a 1.4k-hour model
that can't load in CI. The tests:

  - Validate the synthetic reference WAV builder is deterministic.
  - Validate `_resolve_reference` prefers an on-disk WAV when one
    exists in `ref_dir`, and falls back to a synthetic clip when
    the file is missing.
  - Validate the `synthesise` end-to-end against a stubbed model
    object so the WAV header / pad-trim / peak-normalise path is
    fully covered.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest

from app.indicf5 import IndicF5Model, _synthetic_ref_wav
from app.model import VocalRequest, VocalSection, _write_wav_mono


def _section(
    *,
    voice_id: str | None = "indic_hi_male_broadcast",
    target_seconds: int = 4,
    lyrics: str = "namaste",
) -> VocalSection:
    return VocalSection(
        id="s1",
        type="verse",
        lyrics=lyrics,
        language="hi",
        script="devanagari",
        transliteration=None,
        target_seconds=target_seconds,
        tempo_bpm=90,
        raga_name=None,
        voice_timbre="male",
        voice_id=voice_id,
    )


def _req(*, sections: list[VocalSection], total_seconds: int = 4) -> VocalRequest:
    return VocalRequest(
        job_id="j",
        attempt_id=None,
        trace_id=None,
        language="hi",
        style_family="bollywood-ballad",
        voice_timbre="male",
        sample_rate=24000,
        sections=sections,
        target_duration_seconds=total_seconds,
    )


def test_synthetic_ref_wav_is_deterministic() -> None:
    a = _synthetic_ref_wav(gender="male")
    b = _synthetic_ref_wav(gender="male")
    assert a.shape == b.shape
    assert np.allclose(a, b)


def test_synthetic_ref_wav_pitch_tracks_gender() -> None:
    male = _synthetic_ref_wav(gender="male")
    female = _synthetic_ref_wav(gender="female")
    # Pitch differs → autocorrelation peak differs → not equal.
    assert not np.allclose(male[:100], female[:100])


def test_resolve_reference_prefers_file_over_synthetic(
    tmp_path: Path,
) -> None:
    ref_dir = tmp_path / "refs"
    ref_dir.mkdir()
    # Write a tiny 1-second sine WAV mirroring _write_wav_mono so the
    # IndicF5 reader's 16-bit-PCM contract is exercised.
    samples = (0.1 * np.sin(np.linspace(0, 2 * np.pi, 24000))).astype(
        np.float32
    )
    wav = _write_wav_mono(samples, 24000)
    (ref_dir / "indic_hi_male_broadcast.wav").write_bytes(wav)

    model = IndicF5Model(ref_dir=ref_dir)
    arr, sr, source = model._resolve_reference(
        voice_id="indic_hi_male_broadcast",
    )
    assert source == "file"
    assert sr == 24000
    # Round-trip should produce ~24k samples.
    assert 23990 < arr.size < 24010


def test_resolve_reference_falls_back_to_synthetic_for_missing_file(
    tmp_path: Path,
) -> None:
    model = IndicF5Model(ref_dir=tmp_path)
    arr, sr, source = model._resolve_reference(
        voice_id="indic_hi_male_broadcast",
    )
    assert source == "synthetic"
    assert sr == 24000
    assert arr.size > 0


def test_resolve_reference_falls_back_to_synthetic_for_unknown_voice(
    tmp_path: Path,
) -> None:
    model = IndicF5Model(ref_dir=tmp_path)
    _arr, sr, source = model._resolve_reference(
        voice_id="not-a-real-voice",
    )
    assert source == "synthetic"
    assert sr == 24000


def test_synthesise_requires_load() -> None:
    model = IndicF5Model()
    with pytest.raises(RuntimeError, match=r"load.. not called"):
        model.synthesise(_req(sections=[_section()]))


class _StubInner:
    """Stand-in for the real HF AutoModel.

    Returns a 1-second 24 kHz sine — IndicF5's native rate — so the
    resample + pad/trim path is exercised when the target SR
    differs.
    """

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def __call__(
        self,
        *,
        text: str,
        ref_audio: np.ndarray,
        ref_sr: int,
        language: str,
    ) -> np.ndarray:
        self.calls.append(
            {
                "text": text,
                "ref_audio_size": ref_audio.size,
                "ref_sr": ref_sr,
                "language": language,
            },
        )
        t = np.arange(24000, dtype=np.float32) / 24000.0
        return (0.1 * np.sin(2 * np.pi * 220.0 * t)).astype(np.float32)


def test_synthesise_dispatches_to_inner_model() -> None:
    model = IndicF5Model()
    inner = _StubInner()
    model._model = inner
    model._loaded = True
    out = model.synthesise(
        _req(
            sections=[_section(target_seconds=4)],
            total_seconds=4,
        )
    )
    assert isinstance(out, bytes)
    # WAV header sanity.
    assert out[:4] == b"RIFF"
    assert out[8:12] == b"WAVE"
    # Data length should match 4 seconds * 24000 Hz * 2 bytes.
    data_size = struct.unpack("<I", out[40:44])[0]
    assert data_size == 4 * 24000 * 2
    # Inner model received the IndicF5-flavoured kwargs.
    assert len(inner.calls) == 1
    assert inner.calls[0]["language"] == "hi"
    assert inner.calls[0]["ref_sr"] == 24000


def test_synthesise_skips_instrumental_sections() -> None:
    model = IndicF5Model()
    inner = _StubInner()
    model._model = inner
    model._loaded = True
    instrumental = VocalSection(
        id="instr",
        type="instrumental",
        lyrics=None,
        language="hi",
        script="devanagari",
        transliteration=None,
        target_seconds=2,
        tempo_bpm=90,
        raga_name=None,
        voice_timbre="male",
        voice_id=None,
    )
    out = model.synthesise(
        _req(
            sections=[instrumental, _section(target_seconds=2)],
            total_seconds=4,
        )
    )
    # Only the vocal section should hit the inner model.
    assert len(inner.calls) == 1
    assert isinstance(out, bytes)


def test_synthesise_peak_normalises_to_below_one() -> None:
    """Loud inner output should be brought back under 1.0 to avoid
    clipping when stitched into the mixer downstream."""

    class _LoudInner:
        def __call__(
            self,
            *,
            text: str,
            ref_audio: np.ndarray,
            ref_sr: int,
            language: str,
        ) -> np.ndarray:
            del text, ref_audio, ref_sr, language
            return 5.0 * np.ones(24000, dtype=np.float32)

    model = IndicF5Model()
    model._model = _LoudInner()
    model._loaded = True
    out = model.synthesise(_req(sections=[_section()]))
    # Decode the WAV body and check peak ≤ 0.95.
    data_size = struct.unpack("<I", out[40:44])[0]
    pcm = np.frombuffer(out[44 : 44 + data_size], dtype=np.int16)
    floats = pcm.astype(np.float32) / 32767.0
    assert float(np.max(np.abs(floats))) <= 0.96
