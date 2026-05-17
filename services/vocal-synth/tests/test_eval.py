from __future__ import annotations

import math

import numpy as np

from app.eval import evaluate_wav, evaluate_wav_bytes
from app.model import FakeVocalModel, VocalRequest, VocalSection


def test_silence_scores_zero() -> None:
    samples = np.zeros(48000, dtype=np.float32)
    report = evaluate_wav(samples, sample_rate=24000)
    assert report.voicing_ratio == 0.0
    assert report.overall_score < 0.2  # near-zero (voicing weight 0.6)


def test_pure_tone_scores_well_on_voicing_and_stability() -> None:
    sr = 24000
    t = np.arange(sr * 2, dtype=np.float32) / sr
    samples = 0.3 * np.sin(2 * math.pi * 220.0 * t).astype(np.float32)
    report = evaluate_wav(samples, sample_rate=sr)
    assert report.voicing_ratio > 0.9
    assert report.pitch_stability > 0.5
    assert report.overall_score > 0.5


def test_fake_model_output_passes_basic_eval() -> None:
    fb = FakeVocalModel()
    req = VocalRequest(
        job_id="j",
        attempt_id=None,
        trace_id=None,
        language="hi",
        style_family="hindustani",
        voice_timbre="female",
        sample_rate=24000,
        sections=[
            VocalSection(
                id="s1",
                type="verse",
                lyrics="aaja aaja",
                language="hi",
                script="latin",
                transliteration=None,
                target_seconds=3,
                tempo_bpm=90,
                raga_name=None,
                voice_timbre="female",
            )
        ],
        target_duration_seconds=3,
    )
    buf = fb.synthesise(req)
    report = evaluate_wav_bytes(buf, requested_tempo_bpm=90)
    assert report.rendered_seconds > 2.5
    assert report.voicing_ratio > 0.3


def test_tempo_match_score_handles_doubletime() -> None:
    sr = 24000
    # Amplitude-modulate a tone at 2 Hz so the onset detector gets a
    # voiced signal with clear amplitude peaks at 120 BPM = 2 Hz.
    t = np.arange(sr * 5, dtype=np.float32) / sr
    carrier = 0.4 * np.sin(2 * math.pi * 220.0 * t).astype(np.float32)
    env = 0.5 + 0.5 * np.cos(2 * math.pi * 2.0 * t).astype(np.float32)
    samples = carrier * env
    report = evaluate_wav(samples, sample_rate=sr, requested_tempo_bpm=120)
    assert report.estimated_tempo_bpm is not None
    assert report.tempo_match_score is not None
    assert 0.0 <= report.tempo_match_score <= 1.0


def test_evaluate_wav_bytes_handles_malformed_input() -> None:
    report = evaluate_wav_bytes(b"not a wav file")
    assert report.rendered_seconds == 0.0
    assert report.overall_score == 0.0
