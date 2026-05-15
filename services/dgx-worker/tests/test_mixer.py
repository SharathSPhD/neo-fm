"""Mixer unit tests.

These run without GPU or any model — pure numpy/soundfile mixing.
"""

from __future__ import annotations

import io
import math

import numpy as np
import soundfile as sf

from app.mixer import (
    MixSettings,
    mix_to_stereo_48k,
)


def _make_wav(samples: np.ndarray, sr: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, samples.astype(np.float32), sr, subtype="PCM_16", format="WAV")
    return buf.getvalue()


def _sine(seconds: float, freq: float, sr: int, amp: float = 0.3) -> np.ndarray:
    t = np.arange(int(seconds * sr), dtype=np.float32) / sr
    return amp * np.sin(2 * math.pi * freq * t, dtype=np.float32)


def _decode(buf: bytes) -> tuple[np.ndarray, int]:
    data, sr = sf.read(io.BytesIO(buf), dtype="float32", always_2d=True)
    return data, sr


def test_mixer_resamples_instrumental_to_48k_when_no_vocals() -> None:
    instr = _sine(seconds=1.0, freq=440.0, sr=22050)
    out = mix_to_stereo_48k(instrumental_wav=_make_wav(instr, 22050))
    data, sr = _decode(out)
    assert sr == 48000
    assert data.shape[1] == 2
    # Resampled length: 22050 -> 48000 -> approximately 48000 samples.
    assert abs(data.shape[0] - 48000) < 100
    # Left and right are identical (mono mirrored).
    assert np.allclose(data[:, 0], data[:, 1])


def test_mixer_pads_to_target_duration() -> None:
    instr = _sine(seconds=2.0, freq=220.0, sr=48000)
    out = mix_to_stereo_48k(
        instrumental_wav=_make_wav(instr, 48000),
        target_duration_seconds=4,
    )
    data, sr = _decode(out)
    assert sr == 48000
    # 4 seconds at 48k
    assert abs(data.shape[0] - 4 * 48000) < 10


def test_mixer_adds_vocals_and_ducks_instrumental() -> None:
    # Instrumental: steady 220 Hz, fairly loud.
    instr = _sine(seconds=2.0, freq=220.0, sr=48000, amp=0.5)
    instr_only = mix_to_stereo_48k(
        instrumental_wav=_make_wav(instr, 48000),
        target_duration_seconds=2,
    )
    # Vocal: 880 Hz across the same duration.
    vocal = _sine(seconds=2.0, freq=880.0, sr=48000, amp=0.5)
    with_vocal = mix_to_stereo_48k(
        instrumental_wav=_make_wav(instr, 48000),
        vocal_wavs=[_make_wav(vocal, 48000)],
        target_duration_seconds=2,
    )

    data_i, _ = _decode(instr_only)
    data_v, _ = _decode(with_vocal)
    # Both are stereo, same length.
    assert data_i.shape == data_v.shape

    # The combined output should contain energy at 880 Hz (vocal) that
    # the instrumental-only one does not.
    fft_i = np.fft.rfft(data_i[:, 0])
    fft_v = np.fft.rfft(data_v[:, 0])
    freqs = np.fft.rfftfreq(data_i.shape[0], 1 / 48000)
    bin_880 = int(np.argmin(np.abs(freqs - 880)))
    bin_220 = int(np.argmin(np.abs(freqs - 220)))
    energy_880_with = abs(fft_v[bin_880])
    energy_880_without = abs(fft_i[bin_880])
    assert energy_880_with > energy_880_without * 5

    # The 220 Hz instrumental energy should have *dropped* due to
    # side-chain ducking (it's still present, just attenuated).
    assert abs(fft_v[bin_220]) < abs(fft_i[bin_220])


def test_mixer_averages_multiple_language_vocals() -> None:
    instr = _sine(seconds=1.0, freq=220.0, sr=48000, amp=0.3)
    # Two vocal stems at different frequencies (proxy for hi vs kn).
    vocal_hi = _sine(seconds=1.0, freq=600.0, sr=48000, amp=0.5)
    vocal_kn = _sine(seconds=1.0, freq=750.0, sr=48000, amp=0.5)
    out = mix_to_stereo_48k(
        instrumental_wav=_make_wav(instr, 48000),
        vocal_wavs=[_make_wav(vocal_hi, 48000), _make_wav(vocal_kn, 48000)],
        target_duration_seconds=1,
    )
    data, _ = _decode(out)
    fft = np.fft.rfft(data[:, 0])
    freqs = np.fft.rfftfreq(data.shape[0], 1 / 48000)
    bin_600 = int(np.argmin(np.abs(freqs - 600)))
    bin_750 = int(np.argmin(np.abs(freqs - 750)))
    bin_silence = int(np.argmin(np.abs(freqs - 3000)))
    e600 = float(abs(fft[bin_600]))
    e750 = float(abs(fft[bin_750]))
    es = float(abs(fft[bin_silence]))
    # Both languages should be present, both significantly above noise.
    assert e600 > es * 10
    assert e750 > es * 10


def test_mixer_peak_limits_below_one() -> None:
    # Very loud signal: should be limited to <= peak_target.
    instr = _sine(seconds=0.5, freq=220.0, sr=48000, amp=2.0)
    out = mix_to_stereo_48k(
        instrumental_wav=_make_wav(instr, 48000),
        settings=MixSettings(peak_target=0.9),
    )
    data, _ = _decode(out)
    # 16-bit PCM peak corresponds to ~1.0; 0.9 target is ~29490 in int16.
    pcm_peak = float(np.max(np.abs(data)))
    assert pcm_peak <= 0.95
