"""
Stereo mixdown of instrumental + vocal + transition-stem inputs.

The worker fetches:
  - An instrumental WAV from music-inference (HeartMuLa or MusicGen).
  - Zero or more vocal WAVs from vocal-synth (one per language).
  - Zero or more transition stems from stems-synth (v1.4 Sprint 11):
    tabla tihais, parai breaks, tanpura drones, harmonium swells.

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
  5. v1.4 Sprint 11: layer each transition stem on top of the mix at
     its requested `insert_at_seconds`, with a `crossfade_seconds`
     equal-power fade in/out so the seam between section and stem
     doesn't click.
  6. Sum, soft-knee compress, peak-limit, and write a stereo PCM-16
     WAV at 48 kHz.

The mixer is intentionally pure numpy/soundfile so it can run in CI
without GPU drivers and is testable from the worker test suite. All
parameters have sensible defaults but are tunable via the
``MixSettings`` dataclass.

ADR 0010 (audio normalisation) gets revised in Sprint 5: the worker now
delivers a stereo file when vocals are present, mono when not. Storage
keeps the original `.wav` extension; downstream players cope.
ADR 0031 (v1.4 Sprint 11) adds the stem-insert path; the mixer
delivers stereo whenever either vocals OR stems are present.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass

import numpy as np
import soundfile as sf


@dataclass(frozen=True)
class StemInsert:
    """A single transition stem rendered by stems-synth (v1.4 Sprint 11).

    `audio` is the raw WAV bytes (any sample rate; the mixer
    resamples). `insert_at_seconds` is where the stem should appear
    in the final mix. `crossfade_seconds` controls how much of the
    base mix is faded into / out of the stem region — equal-power so
    the seam stays clickless. `gain` is per-stem linear gain (defaults
    to 1.0; the stem-synth preset already carries a default that the
    worker can multiply into this).
    """
    audio: bytes
    insert_at_seconds: float
    crossfade_seconds: float = 0.5
    gain: float = 1.0
    label: str = ""  # purely for logs


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
    # v1.4 Sprint 11: during a stem insert we duck the base mix
    # *under* the stem so the percussion break has the foreground.
    stem_duck_amount: float = 0.7


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
    new_n = round(samples.size * ratio)
    if new_n <= 1:
        return samples
    # Linear interpolation; numpy's interp is fine for our use case
    # because the source is already low-passed by the upstream model.
    src_idx = np.linspace(0.0, samples.size - 1, new_n, dtype=np.float64)
    resampled: np.ndarray = np.interp(src_idx, np.arange(samples.size), samples).astype(
        np.float32
    )
    return resampled


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
    abs_sig: np.ndarray = np.abs(signal).astype(np.float32)
    env: np.ndarray = np.empty_like(abs_sig)
    prev = 0.0
    for i in range(abs_sig.size):
        x = float(abs_sig[i])
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


def _equal_power_window(n: int, fade_n: int) -> np.ndarray:
    """Build an equal-power envelope of length `n` with `fade_n`
    samples ramping in at the start and `fade_n` samples ramping out
    at the end.

    Used by `_apply_stem_inserts` to fade the stem in/out so the
    insert boundary is clickless. Equal-power means the sum of base+
    stem energy stays roughly constant across the crossfade, instead
    of dipping to half (which a linear fade would cause).
    """
    env = np.ones(n, dtype=np.float32)
    fade_n = max(0, min(fade_n, n // 2))
    if fade_n == 0:
        return env
    ramp = np.linspace(0.0, 1.0, fade_n, dtype=np.float32)
    # equal-power: sin^2 + cos^2 = 1
    env[:fade_n] = np.sin(0.5 * np.pi * ramp).astype(np.float32)
    env[n - fade_n:] = np.cos(0.5 * np.pi * ramp).astype(np.float32)
    return env


def _apply_stem_inserts(
    base: np.ndarray,
    *,
    stems: list[StemInsert],
    sample_rate: int,
    settings: MixSettings,
    log_sink: list[dict[str, object]] | None = None,
) -> np.ndarray:
    """Layer `stems` on top of `base`, ducking the base under each
    stem with an equal-power crossfade.

    `base` may be shorter than the latest stem `insert_at_seconds +
    stem_duration`; in that case we extend `base` with zeros so the
    insert lands without truncation. Each stem mix step logs a tuple
    of `{label, insert_at, duration, gain, peak}` for the worker's
    structured log line (Sprint 11 contract: ≥1 stem insert log per
    transition).
    """
    if not stems:
        return base
    log_sink = log_sink if log_sink is not None else []
    out = base.astype(np.float32, copy=True)
    for stem in stems:
        s, s_sr = _decode_wav(stem.audio)
        s = _resample(s, s_sr, sample_rate)
        if s.size == 0:
            continue
        start = int(max(0.0, stem.insert_at_seconds) * sample_rate)
        end = start + s.size
        if end > out.size:
            out = np.concatenate(
                [out, np.zeros(end - out.size, dtype=np.float32)]
            )
        fade_n = int(max(0.0, stem.crossfade_seconds) * sample_rate)
        env = _equal_power_window(s.size, fade_n)
        stem_signal = (s * env * stem.gain).astype(np.float32)
        # Duck the base under the stem region so the percussion
        # break takes the foreground. The duck mirrors the envelope
        # (equal-power), so we get a smooth crossfade *into* the
        # stem rather than a hard mute.
        if settings.stem_duck_amount > 0.0:
            duck = (1.0 - settings.stem_duck_amount * env).astype(np.float32)
            out[start:end] = out[start:end] * duck
        out[start:end] = out[start:end] + stem_signal
        log_sink.append(
            {
                "label": stem.label or "stem",
                "insert_at_seconds": float(stem.insert_at_seconds),
                "duration_seconds": float(s.size / sample_rate),
                "gain": float(stem.gain),
                "peak": float(np.max(np.abs(stem_signal))) if stem_signal.size else 0.0,
            }
        )
    return out


def mix_to_stereo_48k(
    *,
    instrumental_wav: bytes,
    vocal_wavs: list[bytes] | None = None,
    stem_inserts: list[StemInsert] | None = None,
    target_duration_seconds: int | None = None,
    settings: MixSettings | None = None,
    insert_log: list[dict[str, object]] | None = None,
) -> bytes:
    """Return a stereo 48 kHz PCM-16 WAV.

    - If ``vocal_wavs`` is empty / None and ``target_duration_seconds``
      is None, this is effectively a resample-to-48k path: it decodes
      the instrumental, resamples, peak-limits, and re-encodes stereo.
    - With vocals, vocals are summed (averaged), ducked against the
      instrumental, and the result is mixed.
    - v1.4 Sprint 11: pass ``stem_inserts`` to layer transition stems
      onto the mix with equal-power crossfades. Each insert ducks the
      base mix under it via ``settings.stem_duck_amount``. The
      ``insert_log`` argument, when provided, receives a per-stem dict
      so the worker can log a `mixer_stem_insert` line.
    - Output is centred (mono replicated to L+R). Phase 6 will add a
      width parameter for instrument panning.
    """
    settings = settings or MixSettings()
    sr_out = settings.target_sample_rate

    instr, instr_sr = _decode_wav(instrumental_wav)
    instr_48 = _resample(instr, instr_sr, sr_out)
    stems_inserts = stem_inserts or []

    if not vocal_wavs:
        if target_duration_seconds is not None:
            instr_48 = _pad_or_trim(instr_48, target_duration_seconds * sr_out)
        instr_48 = instr_48 * settings.instrumental_gain
        if stems_inserts:
            instr_48 = _apply_stem_inserts(
                instr_48,
                stems=stems_inserts,
                sample_rate=sr_out,
                settings=settings,
                log_sink=insert_log,
            )
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
    # target_duration_seconds * sr, latest stem insert end).
    candidate_n = [instr_48.size] + [s.size for s in stems]
    if target_duration_seconds is not None:
        candidate_n.append(int(target_duration_seconds * sr_out))
    for ins in stems_inserts:
        ins_s, ins_sr = _decode_wav(ins.audio)
        ins_dur = ins_s.size / max(1, ins_sr) if ins_s.size else 0.0
        candidate_n.append(int((ins.insert_at_seconds + ins_dur) * sr_out))
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
    if stems_inserts:
        mixed = _apply_stem_inserts(
            mixed,
            stems=stems_inserts,
            sample_rate=sr_out,
            settings=settings,
            log_sink=insert_log,
        )
    mixed = _soft_compress(mixed)
    mixed = _peak_limit(mixed, settings.peak_target)
    # Mono replicated to stereo for v1; Sprint 6+ adds panning.
    return _encode_stereo_wav(mixed, mixed, sr_out)


__all__ = [
    "MixSettings",
    "StemInsert",
    "mix_to_stereo_48k",
]
