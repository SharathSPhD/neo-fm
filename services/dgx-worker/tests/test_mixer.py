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
    StemInsert,
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


# --- v1.4 Sprint 11 stem insert tests ---------------------------------------


def test_mixer_inserts_a_single_stem_at_requested_time() -> None:
    """A stem rendered with a distinct frequency (1500 Hz) should
    appear in the mixed FFT spectrum near the insertion point, and
    not elsewhere."""
    instr = _sine(seconds=4.0, freq=220.0, sr=48000, amp=0.3)
    stem = _sine(seconds=2.0, freq=1500.0, sr=48000, amp=0.5)
    inserts = [
        StemInsert(
            audio=_make_wav(stem, 48000),
            insert_at_seconds=1.0,
            crossfade_seconds=0.1,
            gain=1.0,
            label="parai_break_1",
        )
    ]
    log: list[dict[str, object]] = []
    out = mix_to_stereo_48k(
        instrumental_wav=_make_wav(instr, 48000),
        stem_inserts=inserts,
        target_duration_seconds=4,
        insert_log=log,
    )
    data, _ = _decode(out)

    # The insertion window covers [1.0s, 3.0s]. Sample windowed FFTs:
    # check the inside window has substantially more 1500 Hz energy
    # than the outside window.
    inside = data[int(1.2 * 48000) : int(2.8 * 48000), 0]
    outside = data[int(3.2 * 48000) : int(3.9 * 48000), 0]
    freqs_in = np.fft.rfftfreq(inside.size, 1 / 48000)
    freqs_out = np.fft.rfftfreq(outside.size, 1 / 48000)
    bin_in = int(np.argmin(np.abs(freqs_in - 1500)))
    bin_out = int(np.argmin(np.abs(freqs_out - 1500)))
    e_inside = float(abs(np.fft.rfft(inside)[bin_in]))
    e_outside = float(abs(np.fft.rfft(outside)[bin_out]))
    assert e_inside > e_outside * 10

    # Log captured exactly one insert.
    assert len(log) == 1
    assert log[0]["label"] == "parai_break_1"
    assert log[0]["insert_at_seconds"] == 1.0


def test_mixer_logs_three_stem_inserts_for_section_transitions() -> None:
    """Sprint 11 plan §11 contract: a bhavageete render with section
    transitions must log three stem inserts. We assert the
    insert_log length here so the worker-side e2e can rely on it.
    """
    instr = _sine(seconds=20.0, freq=220.0, sr=48000, amp=0.3)
    stem_a = _sine(seconds=4.0, freq=1500.0, sr=48000, amp=0.4)
    stem_b = _sine(seconds=4.0, freq=2000.0, sr=48000, amp=0.4)
    stem_c = _sine(seconds=4.0, freq=2500.0, sr=48000, amp=0.4)
    inserts = [
        StemInsert(
            audio=_make_wav(stem_a, 48000),
            insert_at_seconds=4.0,
            label="harmonium_interlude",
        ),
        StemInsert(
            audio=_make_wav(stem_b, 48000),
            insert_at_seconds=10.0,
            label="tabla_tihai",
        ),
        StemInsert(
            audio=_make_wav(stem_c, 48000),
            insert_at_seconds=15.0,
            label="tanpura_drone",
        ),
    ]
    log: list[dict[str, object]] = []
    mix_to_stereo_48k(
        instrumental_wav=_make_wav(instr, 48000),
        stem_inserts=inserts,
        target_duration_seconds=20,
        insert_log=log,
    )
    assert [entry["label"] for entry in log] == [
        "harmonium_interlude",
        "tabla_tihai",
        "tanpura_drone",
    ]


def test_mixer_ducks_base_under_stem_insert() -> None:
    """With `stem_duck_amount > 0`, the base mix amplitude during the
    insert window should be lower than the same band outside the
    window."""
    instr = _sine(seconds=4.0, freq=220.0, sr=48000, amp=0.5)
    stem = _sine(seconds=2.0, freq=4000.0, sr=48000, amp=0.5)
    out = mix_to_stereo_48k(
        instrumental_wav=_make_wav(instr, 48000),
        stem_inserts=[
            StemInsert(
                audio=_make_wav(stem, 48000),
                insert_at_seconds=1.0,
                crossfade_seconds=0.05,
            )
        ],
        target_duration_seconds=4,
        settings=MixSettings(stem_duck_amount=0.9),
    )
    data, _ = _decode(out)
    inside = data[int(1.5 * 48000) : int(2.5 * 48000), 0]
    outside = data[int(3.2 * 48000) : int(3.9 * 48000), 0]
    freqs = np.fft.rfftfreq(min(inside.size, outside.size), 1 / 48000)
    bin_220 = int(np.argmin(np.abs(freqs - 220)))
    inside_clip = inside[: min(inside.size, outside.size)]
    outside_clip = outside[: min(inside.size, outside.size)]
    e_in = float(abs(np.fft.rfft(inside_clip)[bin_220]))
    e_out = float(abs(np.fft.rfft(outside_clip)[bin_220]))
    # Ducked region has clearly less 220 Hz energy than the un-ducked
    # outside region.
    assert e_in < e_out * 0.7


def test_mixer_extends_base_when_stem_inserts_past_end() -> None:
    """If a stem is requested past the end of the instrumental track,
    we extend the base with zeros rather than dropping the stem."""
    instr = _sine(seconds=2.0, freq=220.0, sr=48000, amp=0.3)
    stem = _sine(seconds=1.0, freq=1500.0, sr=48000, amp=0.5)
    out = mix_to_stereo_48k(
        instrumental_wav=_make_wav(instr, 48000),
        stem_inserts=[
            StemInsert(
                audio=_make_wav(stem, 48000),
                insert_at_seconds=2.5,
                crossfade_seconds=0.05,
            )
        ],
    )
    data, _ = _decode(out)
    # Mix length now reaches the stem-end at 3.5s; allow a small
    # margin for the soft compressor's tail.
    assert data.shape[0] >= int(3.4 * 48000)


def test_mixer_handles_vocals_and_stems_together() -> None:
    """End-to-end smoke for a bhavageete-shaped render: instrumental
    + vocal stem + three transition stems. The FFT should carry the
    instrumental, the vocal, and the stem frequencies."""
    instr = _sine(seconds=10.0, freq=220.0, sr=48000, amp=0.3)
    vocal = _sine(seconds=10.0, freq=880.0, sr=48000, amp=0.4)
    stem_a = _sine(seconds=2.0, freq=1500.0, sr=48000, amp=0.4)
    stem_b = _sine(seconds=2.0, freq=3000.0, sr=48000, amp=0.4)
    out = mix_to_stereo_48k(
        instrumental_wav=_make_wav(instr, 48000),
        vocal_wavs=[_make_wav(vocal, 48000)],
        stem_inserts=[
            StemInsert(
                audio=_make_wav(stem_a, 48000),
                insert_at_seconds=3.0,
                label="tabla_tihai",
            ),
            StemInsert(
                audio=_make_wav(stem_b, 48000),
                insert_at_seconds=6.0,
                label="parai_break",
            ),
        ],
        target_duration_seconds=10,
    )
    data, _ = _decode(out)
    fft = np.fft.rfft(data[:, 0])
    freqs = np.fft.rfftfreq(data.shape[0], 1 / 48000)

    def energy_at(hz: float) -> float:
        return float(abs(fft[int(np.argmin(np.abs(freqs - hz)))]))

    # All four bands present, none dominating at noise level.
    assert energy_at(220) > energy_at(8000) * 5
    assert energy_at(880) > energy_at(8000) * 5
    assert energy_at(1500) > energy_at(8000) * 5
    assert energy_at(3000) > energy_at(8000) * 5
