"""`NeMoTTSModel`: NVIDIA NeMo cascaded TTS backend (v1.4 Sprint 13).

Sprint 13's flagship language is **Kannada** — the gap between the
existing open Indic TTS models and the bhavageete moat is widest
there, and the AI4Bharat IndicTTS Kannada subset (~7 h) plus the
IndicVoices-R Kannada filter (~30 h) gives us enough data to train
a genuine in-house FastPitch + HiFi-GAN cascade on the DGX Spark
GB10.

Architecture mirrors the existing backend pattern:

  - `app/nemo.py` (this file) wraps the NeMo `SpectrogramGenerator`
    (FastPitch) + `Vocoder` (HiFi-GAN) pair.
  - `app/routing.py` is widened by one arm so a catalogue entry
    with ``backend == "nemo"`` lands here.
  - 2 catalogue entries (`indic_kn_male_warm`,
    `indic_kn_female_bhajan`) flip from Parler to NeMo, picking up
    the in-house weights pushed to HuggingFace at
    ``neo-fm/nemo-tts-kannada-v1``.

CI does not run the real NeMo path — `nemo_toolkit` is a 2 GB
install and the weights are not vendored. We test the dispatch +
WAV-shape contract against a stubbed inner pair, and lock the
training script into a `--dry-run` mode whose output is asserted by
unit tests. The DGX-side training run produces a real adapter +
real synthesis; the operator copies the weights into
``VOCAL_NEMO_KN_DIR`` (env or
``app/voice_refs/nemo/kannada/``) and ``load()`` picks them up.
"""

from __future__ import annotations

import contextlib
import os
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Any

import numpy as np

from .model import VocalRequest, _write_wav_mono
from .voice_catalog import get_voice

_DEFAULT_KN_DIR = (
    Path(__file__).resolve().parent / "voice_refs" / "nemo" / "kannada"
)


class NeMoTTSModel:
    """NeMo FastPitch + HiFi-GAN cascade.

    `load()` loads two artefacts:

      - ``fastpitch.nemo`` — the spectrogram generator. Conditioned
        on the persona's speaker id from
        ``app/voice_refs/nemo/kannada/speaker_map.json``.
      - ``hifigan.nemo`` — the vocoder.

    Both files live under :attr:`weights_dir`, which the operator
    populates with the DGX-trained weights. CI never touches this
    path: we test against a stub.
    """

    def __init__(
        self,
        *,
        weights_dir: Path | None = None,
        language: str = "kn",
    ) -> None:
        env_dir = os.environ.get("VOCAL_NEMO_KN_DIR")
        if weights_dir is not None:
            self._weights_dir = weights_dir
        elif env_dir:
            self._weights_dir = Path(env_dir)
        else:
            self._weights_dir = _DEFAULT_KN_DIR
        self._language = language
        self._fastpitch: object | None = None
        self._vocoder: object | None = None
        self._speaker_map: dict[str, int] = {}
        self._sample_rate: int = 22050  # NeMo FastPitch default
        self._loaded = False
        self._inference_mode: type[AbstractContextManager[object]] = (
            contextlib.nullcontext
        )
        self._device: str = "cpu"

    @property
    def model_loaded(self) -> bool:
        return self._loaded

    @property
    def model_version(self) -> str | None:
        return (
            f"nemo-tts-{self._language}-v1@{self._weights_dir.name}"
            if self._loaded
            else None
        )

    @property
    def weights_dir(self) -> Path:
        return self._weights_dir

    def load(self) -> None:
        if self._loaded:
            return
        import json

        import torch  # type: ignore[import-not-found]

        try:
            # NeMo TTS imports. Defer so unit tests + non-DGX hosts
            # don't pay for them at module load.
            from nemo.collections.tts.models import (  # type: ignore[import-not-found]
                FastPitchModel,
                HifiGanModel,
            )
        except ImportError as e:
            raise RuntimeError(
                "nemo_toolkit is not installed. On DGX run "
                "`uv pip install 'nemo_toolkit[tts]==1.23.*'`. "
                "CI uses the stubbed test path."
            ) from e

        fp_path = self._weights_dir / "fastpitch.nemo"
        hg_path = self._weights_dir / "hifigan.nemo"
        if not (fp_path.exists() and hg_path.exists()):
            raise RuntimeError(
                f"NeMo weights missing under {self._weights_dir}; expected "
                f"fastpitch.nemo + hifigan.nemo."
            )
        spk_path = self._weights_dir / "speaker_map.json"
        if spk_path.exists():
            self._speaker_map = json.loads(spk_path.read_text(encoding="utf-8"))

        self._device = (
            "cuda"
            if torch.cuda.is_available()
            else "mps"
            if getattr(torch.backends, "mps", None)
            and torch.backends.mps.is_available()
            else "cpu"
        )
        self._fastpitch = (
            FastPitchModel.restore_from(str(fp_path)).to(self._device).eval()
        )
        self._vocoder = (
            HifiGanModel.restore_from(str(hg_path)).to(self._device).eval()
        )
        self._sample_rate = getattr(
            self._fastpitch, "sample_rate", 22050
        )
        self._inference_mode = torch.inference_mode
        self._loaded = True

    def _speaker_id_for(self, voice_id: str | None) -> int:
        """Look up the NeMo speaker integer for a catalogue voice_id.

        Falls back to speaker id 0 (the multi-speaker model's
        default) when the catalogue lookup fails — this mirrors the
        Parler fallback in `_pick_backend` so a stale `voice_id`
        never breaks a render.
        """
        if voice_id and voice_id in self._speaker_map:
            return int(self._speaker_map[voice_id])
        entry = get_voice(voice_id) if voice_id else None
        if entry is not None and entry.voice_id in self._speaker_map:
            return int(self._speaker_map[entry.voice_id])
        return 0

    def _generate_one(
        self,
        *,
        text: str,
        speaker_id: int,
        target_seconds: float,
    ) -> np.ndarray:
        """Call FastPitch then HiFi-GAN; return mono float32 audio.

        Kept narrow so a future NeMo bump that changes the API only
        touches this method (and the stub in `_TestableNeMoInner`).
        """
        with self._inference_mode():
            spec = self._fastpitch.generate_spectrogram(  # type: ignore[union-attr]
                tokens=text,
                speaker=speaker_id,
            )
            wav = self._vocoder.convert_spectrogram_to_audio(spec=spec)  # type: ignore[union-attr]
        audio = np.asarray(wav, dtype=np.float32).squeeze()
        target_n = int(target_seconds * self._sample_rate)
        if audio.size < target_n:
            audio = np.concatenate(
                [audio, np.zeros(target_n - audio.size, dtype=np.float32)]
            )
        else:
            audio = audio[:target_n]
        return audio

    def synthesise(self, req: VocalRequest) -> bytes:
        if not self._loaded:
            raise RuntimeError("NeMoTTSModel.load() not called")
        sr = req.sample_rate
        chunks: list[np.ndarray] = []
        for sec in req.sections:
            if sec.type == "instrumental" or not (
                sec.lyrics or sec.transliteration
            ):
                chunks.append(
                    np.zeros(int(sec.target_seconds * sr), dtype=np.float32)
                )
                continue
            text = sec.transliteration or sec.lyrics or ""
            stem = self._generate_one(
                text=text,
                speaker_id=self._speaker_id_for(sec.voice_id),
                target_seconds=float(sec.target_seconds),
            )
            src_sr = self._sample_rate
            if src_sr != sr and stem.size > 0:
                ratio = sr / src_sr
                new_n = int(stem.size * ratio)
                idx = np.linspace(0, stem.size - 1, new_n).astype(np.int64)
                stem = stem[idx]
            chunks.append(stem)
        out = (
            np.concatenate(chunks)
            if chunks
            else np.zeros(0, dtype=np.float32)
        )
        target_n = int(req.target_duration_seconds * sr)
        if out.size < target_n:
            out = np.concatenate(
                [out, np.zeros(target_n - out.size, dtype=np.float32)]
            )
        else:
            out = out[:target_n]
        peak = float(np.max(np.abs(out)) or 1.0)
        if peak > 0.95:
            out = out * (0.95 / peak)
        return _write_wav_mono(out, sr)


def install_stub_inner(
    model: NeMoTTSModel,
    *,
    fastpitch: Any,
    vocoder: Any,
    sample_rate: int = 22050,
    speaker_map: dict[str, int] | None = None,
) -> None:
    """Test helper: bolt a stubbed FastPitch + HiFi-GAN pair onto
    an unloaded model so the synthesis path runs without NeMo
    installed. Mirrors the IndicF5 `_StubInner` pattern."""
    model._fastpitch = fastpitch
    model._vocoder = vocoder
    model._sample_rate = sample_rate
    model._speaker_map = speaker_map or {}
    model._loaded = True


__all__ = ["NeMoTTSModel", "install_stub_inner"]
