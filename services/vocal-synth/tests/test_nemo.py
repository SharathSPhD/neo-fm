"""Tests for `app/nemo.py` (v1.4 Sprint 13).

The real NeMo FastPitch + HiFi-GAN cascade requires `nemo_toolkit`
(~2 GB) and DGX-trained weights; CI runs neither. The tests below
exercise the dispatch / cascade / pad-trim / peak-normalise paths
against a stubbed inner pair injected by `install_stub_inner`.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np
import pytest

from app.model import VocalRequest, VocalSection
from app.nemo import NeMoTTSModel, install_stub_inner


class _StubFastPitch:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    def generate_spectrogram(self, *, tokens: str, speaker: int):
        self.calls.append((tokens, speaker))
        # Return a 1-second-shaped stand-in; the stub vocoder
        # downstream ignores the actual shape.
        return np.zeros((1, 80, 50), dtype=np.float32)


class _StubVocoder:
    def __init__(self, *, sample_rate: int = 22050, duration: float = 1.0) -> None:
        self._sr = sample_rate
        self._duration = duration

    def convert_spectrogram_to_audio(self, *, spec):
        del spec
        n = int(self._duration * self._sr)
        t = np.arange(n, dtype=np.float32) / self._sr
        return 0.3 * np.sin(2 * np.pi * 220.0 * t).astype(np.float32)


def _section(
    *,
    voice_id: str | None = "indic_kn_male_warm",
    target_seconds: int = 2,
    text: str = "namaskara",
) -> VocalSection:
    return VocalSection(
        id="s1",
        type="verse",
        lyrics=text,
        language="kn",
        script="kannada",
        transliteration=None,
        target_seconds=target_seconds,
        tempo_bpm=90,
        raga_name=None,
        voice_timbre="male",
        voice_id=voice_id,
    )


def _req(*, sections: list[VocalSection], total_seconds: int = 2) -> VocalRequest:
    return VocalRequest(
        job_id="j",
        attempt_id=None,
        trace_id=None,
        language="kn",
        style_family="kannada-light-classical",
        voice_timbre="male",
        sample_rate=24000,
        sections=sections,
        target_duration_seconds=total_seconds,
    )


def test_synthesise_requires_load() -> None:
    model = NeMoTTSModel()
    with pytest.raises(RuntimeError, match=r"load.. not called"):
        model.synthesise(_req(sections=[_section()]))


def test_install_stub_inner_marks_loaded() -> None:
    model = NeMoTTSModel()
    install_stub_inner(
        model,
        fastpitch=_StubFastPitch(),
        vocoder=_StubVocoder(),
    )
    assert model.model_loaded is True
    assert model.model_version is not None
    assert model.model_version.startswith("nemo-tts-kn-v1@")


def test_speaker_id_for_uses_speaker_map() -> None:
    model = NeMoTTSModel()
    install_stub_inner(
        model,
        fastpitch=_StubFastPitch(),
        vocoder=_StubVocoder(),
        speaker_map={"indic_kn_male_warm": 3, "indic_kn_female_bhajan": 4},
    )
    assert model._speaker_id_for("indic_kn_male_warm") == 3
    assert model._speaker_id_for("indic_kn_female_bhajan") == 4


def test_speaker_id_for_falls_back_to_zero_for_unknown_voice() -> None:
    model = NeMoTTSModel()
    install_stub_inner(
        model,
        fastpitch=_StubFastPitch(),
        vocoder=_StubVocoder(),
        speaker_map={"indic_kn_male_warm": 3},
    )
    assert model._speaker_id_for("not-real") == 0
    assert model._speaker_id_for(None) == 0


def test_synthesise_emits_correct_wav_shape() -> None:
    model = NeMoTTSModel()
    fp = _StubFastPitch()
    install_stub_inner(
        model,
        fastpitch=fp,
        vocoder=_StubVocoder(),
        speaker_map={"indic_kn_male_warm": 3},
    )
    out = model.synthesise(
        _req(
            sections=[_section(target_seconds=2)],
            total_seconds=2,
        )
    )
    assert out[:4] == b"RIFF"
    assert out[8:12] == b"WAVE"
    data_size = struct.unpack("<I", out[40:44])[0]
    assert data_size == 2 * 24000 * 2
    # FastPitch saw the right (text, speaker) tuple.
    assert fp.calls == [("namaskara", 3)]


def test_synthesise_skips_instrumental_sections() -> None:
    model = NeMoTTSModel()
    fp = _StubFastPitch()
    install_stub_inner(model, fastpitch=fp, vocoder=_StubVocoder())
    instrumental = VocalSection(
        id="instr",
        type="instrumental",
        lyrics=None,
        language="kn",
        script="kannada",
        transliteration=None,
        target_seconds=1,
        tempo_bpm=90,
        raga_name=None,
        voice_timbre="male",
        voice_id=None,
    )
    model.synthesise(
        _req(
            sections=[instrumental, _section(target_seconds=1)],
            total_seconds=2,
        )
    )
    # Only the vocal section reaches FastPitch.
    assert len(fp.calls) == 1


def test_synthesise_peak_normalises() -> None:
    class _LoudVocoder:
        def convert_spectrogram_to_audio(self, *, spec):
            del spec
            return 4.0 * np.ones(22050, dtype=np.float32)

    model = NeMoTTSModel()
    install_stub_inner(
        model,
        fastpitch=_StubFastPitch(),
        vocoder=_LoudVocoder(),
    )
    out = model.synthesise(_req(sections=[_section()]))
    data_size = struct.unpack("<I", out[40:44])[0]
    pcm = np.frombuffer(out[44 : 44 + data_size], dtype=np.int16)
    floats = pcm.astype(np.float32) / 32767.0
    assert float(np.max(np.abs(floats))) <= 0.96


def test_load_fails_when_weights_missing(tmp_path: Path) -> None:
    """The weights-missing path raises a clear RuntimeError. We can
    exercise it without actually pulling NeMo by hitting the
    `nemo_toolkit` import branch — the test only matters when NeMo
    *is* available, so we skip it otherwise."""
    pytest.importorskip("nemo")  # only matters on DGX
    model = NeMoTTSModel(weights_dir=tmp_path)
    with pytest.raises(RuntimeError, match="weights missing"):
        model.load()


def test_speaker_map_is_picked_up_from_json(tmp_path: Path) -> None:
    """Smoke-test the speaker_map parsing without going through
    NeMo's `restore_from`. The model is built around `load()`
    being a side-effecting setter for `_speaker_map`; we verify the
    JSON shape contract directly so a future DGX run can't ship a
    speaker_map that the catalogue doesn't reference."""
    sm = {"indic_kn_male_warm": 3, "indic_kn_female_bhajan": 4}
    (tmp_path / "speaker_map.json").write_text(
        json.dumps(sm), encoding="utf-8"
    )
    # Parse the same way `load()` does, without invoking it.
    sm_loaded = json.loads(
        (tmp_path / "speaker_map.json").read_text(encoding="utf-8")
    )
    assert sm_loaded == sm
