"""
Stereo mixdown of instrumental + vocal stems.

The worker fetches:
  - An instrumental WAV from music-inference (HeartMuLa).
  - Zero or more vocal WAVs from vocal-synth (one per language).

`mix_to_stereo_48k` does the rest:

  1. Decode each WAV via `soundfile` to float32 mono at its native rate.
  2. Resample everything to 48 kHz (linear interp; "good enough" for
     synthesis output that is already band-limited at the source).
  3. Time-align: pad / trim to the longer of (instrumental,
     target_seconds). Vocals never lengthen the song; they are
     clipped to the song length so a misbehaving TTS doesn't stretch
     a 30s track into 60s.
  4. Side-chain duck the instrumental against a smoothed envelope of
     the (summed) vocal so the lead sits clearly above the bed.
  5. Sum, soft-knee compress, peak-limit, and write a stereo PCM-16
     WAV at 48 kHz.

The mixer is intentionally pure numpy/soundfile so it can run in CI
without GPU drivers and is testable from the worker test suite. All
parameters have sensible defaults but are tunable via the
``MixSettings`` dataclass.

ADR 0010 (audio normalisation) gets revised in Sprint 5: the worker now
delivers a stereo file when vocals are present, mono when not. Storage
keeps the original `.wav` extension; downstream players cope.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass

import numpy as np
import soundfile as sf


@dataclass(frozen=True)
class MixSettings:
    target_sample_rate: int = 48000
    # Vocal gain relative to instrumental (linear, not dB). 1.0 = unity.
    vocal_gain: float = 1.0
    instrumental_gain: float = 0.9
    # Ducking: how much (linearly) the instrumental drops under vocals.
    # 0.0 = no duck; 0.6 = drop by 60% of instrumental level at peaks.
    duck_amount: float = 0.6
    # Smoothing window for the duck envelope (seconds).
    duck_attack_seconds: float = 0.05
    duck_release_seconds: float = 0.20
    # Final soft limiter target peak (linear).
    peak_target: float = 0.95


def _decode_wav(buf: bytes) -> tuple[np.ndarray, int]:
    """Return (samples_float32, sr). Stereo collapses to mono via mean."""
    data, sr = sf.read(io.BytesIO(buf), dtype="float32", always_2d=False)
    if data.ndim == 2:
        data = data.mean(axis=1)
    return data.astype(np.float32, copy=False), int(sr)


def _resample(samples: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr or samples.size == 0:
        return samples
    ratio = dst_sr / src_sr
    new_n = int(round(samples.size * ratio))
    if new_n <= 1:
        return samples
    # Linear interpolation; numpy's interp is fine for our use case
    # because the source is already low-passed by the upstream model.
    src_idx = np.linspace(0.0, samples.size - 1, new_n, dtype=np.float64)
    return np.interp(src_idx, np.arange(samples.size), samples).astype(np.float32)


def _pad_or_trim(samples: np.ndarray, target_n: int) -> np.ndarray:
    if samples.size == target_n:
        return samples
    if samples.size > target_n:
        return samples[:target_n]
    return np.concatenate(
        [samples, np.zeros(target_n - samples.size, dtype=np.float32)]
    )


def _one_pole_envelope(
    signal: np.ndarray,
    sample_rate: int,
    attack_seconds: float,
    release_seconds: float,
) -> np.ndarray:
    """One-pole asymmetric envelope follower (attack/release coefficients).

    Returns a float32 array the same length as ``signal``. Uses |signal|
    as the input level, then runs an attack/release smoother. Pure
    Python loop on float32 is fast enough at 48 kHz for our song
    lengths (<= 360s ~ 17M samples).
    """
    if signal.size == 0:
        return signal
    a_coef = math.exp(-1.0 / max(1, int(attack_seconds * sample_rate)))
    r_coef = math.exp(-1.0 / max(1, int(release_seconds * sample_rate)))
    abs_sig = np.abs(signal).astype(np.float32)
    env = np.empty_like(abs_sig)
    prev = 0.0
    for i in range(abs_sig.size):
        x = abs_sig[i]
        if x > prev:
            prev = a_coef * prev + (1 - a_coef) * x
        else:
            prev = r_coef * prev + (1 - r_coef) * x
        env[i] = prev
    return env


def _soft_compress(samples: np.ndarray, threshold: float = 0.7, ratio: float = 4.0) -> np.ndarray:
    """Soft-knee 4:1 compressor above ``threshold``. In-place safe."""
    if samples.size == 0:
        return samples
    abs_s = np.abs(samples)
    over = np.maximum(0.0, abs_s - threshold)
    # Avoid divide-by-zero at silence by clamping the denominator; the
    # `where` below still selects 1.0 for those bins, so the value is
    # discarded -- this just keeps numpy quiet.
    safe_abs = np.maximum(abs_s, 1e-12).astype(np.float32)
    gain = np.where(
        abs_s > threshold,
        (threshold + over / ratio) / safe_abs,
        1.0,
    ).astype(np.float32)
    return (samples * gain).astype(np.float32)


def _peak_limit(samples: np.ndarray, target_peak: float = 0.95) -> np.ndarray:
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak <= target_peak or peak == 0.0:
        return samples
    return (samples * (target_peak / peak)).astype(np.float32)


def _encode_stereo_wav(left: np.ndarray, right: np.ndarray, sr: int) -> bytes:
    out = io.BytesIO()
    stereo = np.stack([left, right], axis=1).astype(np.float32)
    sf.write(out, stereo, sr, subtype="PCM_16", format="WAV")
    return out.getvalue()


def _encode_mono_wav(samples: np.ndarray, sr: int) -> bytes:
    out = io.BytesIO()
    sf.write(out, samples.astype(np.float32), sr, subtype="PCM_16", format="WAV")
    return out.getvalue()


def mix_to_stereo_48k(
    *,
    instrumental_wav: bytes,
    vocal_wavs: list[bytes] | None = None,
    target_duration_seconds: int | None = None,
    settings: MixSettings | None = None,
) -> bytes:
    """Return a stereo 48 kHz PCM-16 WAV.

    - If ``vocal_wavs`` is empty / None and ``target_duration_seconds``
      is None, this is effectively a resample-to-48k path: it decodes
      the instrumental, resamples, peak-limits, and re-encodes stereo.
    - With vocals, vocals are summed (averaged), ducked against the
      instrumental, and the result is mixed.
    - Output is centred (mono replicated to L+R). Phase 6 will add a
      width parameter for instrument panning.
    """
    settings = settings or MixSettings()
    sr_out = settings.target_sample_rate

    instr, instr_sr = _decode_wav(instrumental_wav)
    instr_48 = _resample(instr, instr_sr, sr_out)

    if not vocal_wavs:
        if target_duration_seconds is not None:
            instr_48 = _pad_or_trim(instr_48, target_duration_seconds * sr_out)
        instr_48 = instr_48 * settings.instrumental_gain
        instr_48 = _soft_compress(instr_48)
        instr_48 = _peak_limit(instr_48, settings.peak_target)
        return _encode_stereo_wav(instr_48, instr_48, sr_out)

    # Decode + resample each vocal stem.
    stems: list[np.ndarray] = []
    for wav in vocal_wavs:
        s, s_sr = _decode_wav(wav)
        s_48 = _resample(s, s_sr, sr_out)
        stems.append(s_48)

    # Time-align: target length is max(instrumental, longest vocal,
    # target_duration_seconds * sr).
    candidate_n = [instr_48.size] + [s.size for s in stems]
    if target_duration_seconds is not None:
        candidate_n.append(int(target_duration_seconds * sr_out))
    target_n = max(candidate_n)

    instr_48 = _pad_or_trim(instr_48, target_n)
    vocals_aligned = [_pad_or_trim(s, target_n) for s in stems]

    # Average the vocals (so adding more languages doesn't pile up gain).
    if len(vocals_aligned) == 1:
        vocal_sum = vocals_aligned[0]
    else:
        vocal_sum = np.mean(np.stack(vocals_aligned, axis=0), axis=0).astype(np.float32)

    vocal_sum = vocal_sum * settings.vocal_gain

    # Side-chain duck: instrumental level is reduced by an envelope
    # tracking the vocals. Reduction = duck_amount * normalised env.
    if settings.duck_amount > 0.0:
        env = _one_pole_envelope(
            vocal_sum,
            sr_out,
            settings.duck_attack_seconds,
            settings.duck_release_seconds,
        )
        if env.size:
            env_peak = float(np.max(env)) or 1.0
            env_norm = env / env_peak
            duck = 1.0 - settings.duck_amount * env_norm
            instr_48 = (instr_48 * duck).astype(np.float32)

    instr_48 = instr_48 * settings.instrumental_gain
    mixed = (instr_48 + vocal_sum).astype(np.float32)
    mixed = _soft_compress(mixed)
    mixed = _peak_limit(mixed, settings.peak_target)
    # Mono replicated to stereo for v1; Sprint 6+ adds panning.
    return _encode_stereo_wav(mixed, mixed, sr_out)
