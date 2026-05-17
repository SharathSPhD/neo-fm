"""`IndicF5Model`: AI4Bharat IndicF5 backend (v1.4 Sprint 12).

IndicF5 (`ai4bharat/IndicF5`) is a 1,417-hour multilingual TTS model
covering 11 Indian languages with near-human MOS in independent
evaluation. Per research-3 it's the strongest free option for
*natural* Indic speech short of building our own NeMo model — so we
slot it in for the `indic_*` personas whose `voice_catalog.json`
entry sets `"backend": "indicf5"`.

Key contract differences vs `ParlerTTSModel`:

  - **Speaker reference WAV, not text descriptor.** IndicF5 conditions
    on a ~10-second reference clip (its "voice clone"). We mirror
    each catalogue persona to a reference WAV under the
    ``VOCAL_INDICF5_REF_DIR`` directory; the operator pre-renders
    these via `scripts/render_voice_previews.py` and ships them
    alongside the catalogue. Falls back to a synthetic in-process
    reference (`_synthetic_ref_wav`) when the file is missing so
    the unit tests + smoke run don't require the asset.
  - **24 kHz native, we resample to the request's sample_rate.**
  - **`load()` defers heavy imports** so importing this module is
    free in CI (same pattern as `parler.py`).

The router (`routing.py`) is taught about this backend in this
sprint: when a section's `voice_id` resolves to a catalogue entry
whose `backend == "indicf5"`, the router fetches the reference WAV
for that persona and dispatches here. Unknown reference files
soft-fail to the existing `parler` route.
"""

from __future__ import annotations

import contextlib
import os
from contextlib import AbstractContextManager
from pathlib import Path

import numpy as np

from .model import VocalRequest, _write_wav_mono
from .voice_catalog import get_voice

_DEFAULT_REF_DIR = Path(__file__).resolve().parent / "voice_refs" / "indicf5"


def _synthetic_ref_wav(*, gender: str, sample_rate: int = 24000) -> np.ndarray:
    """Build a deterministic 10 s synthetic reference clip.

    The clip is *not* meant to be a good reference — it exists so
    the unit tests can exercise the load / dispatch path without
    requiring 16 actual recorded WAVs on disk. The real DGX
    deployment overrides this with curated reference clips.

    Pitch tracks `gender` so different personas at least produce
    different shapes when the synthetic ref is used.
    """
    duration = 10.0
    base_hz = {"male": 130.0, "female": 220.0, "androgynous": 175.0}.get(
        gender, 175.0
    )
    n = int(duration * sample_rate)
    t = np.arange(n, dtype=np.float32) / float(sample_rate)
    wave = 0.2 * np.sin(2 * np.pi * base_hz * t).astype(np.float32)
    return wave


class IndicF5Model:
    """IndicF5 backend. Mirrors `ParlerTTSModel.synthesise` surface."""

    def __init__(
        self,
        model_id: str = "ai4bharat/IndicF5",
        *,
        ref_dir: Path | None = None,
    ) -> None:
        self._model_id = model_id
        env_dir = os.environ.get("VOCAL_INDICF5_REF_DIR")
        if ref_dir is not None:
            self._ref_dir = ref_dir
        elif env_dir:
            self._ref_dir = Path(env_dir)
        else:
            self._ref_dir = _DEFAULT_REF_DIR
        self._loaded = False
        self._model: object | None = None
        self._device: str = "cpu"
        # `inference_mode` is `torch.inference_mode` after `load()`;
        # tests skip `load()` so we default to a no-op context so the
        # generation loop is importable without torch.
        self._inference_mode: type[AbstractContextManager[object]] = (
            contextlib.nullcontext
        )

    @property
    def model_loaded(self) -> bool:
        return self._loaded

    @property
    def model_version(self) -> str | None:
        return self._model_id if self._loaded else None

    @property
    def ref_dir(self) -> Path:
        """Public so tests can stub it."""
        return self._ref_dir

    def load(self) -> None:
        if self._loaded:
            return
        # Heavy imports live inside load(). Tests stub the backend
        # before reaching this code, so the unit suite never imports
        # torch.
        import torch  # type: ignore[import-not-found]
        from huggingface_hub import snapshot_download  # type: ignore[import-not-found]

        try:
            from transformers import AutoModel  # type: ignore[import-not-found]
        except ImportError as e:
            raise RuntimeError(
                "transformers is not installed. Add it to vocal-synth "
                "requirements when enabling the IndicF5 backend."
            ) from e

        cache_dir = os.environ.get("HF_HOME") or os.environ.get(
            "HUGGINGFACE_HUB_CACHE"
        )
        local_path = snapshot_download(
            self._model_id,
            cache_dir=cache_dir,
            local_files_only=os.environ.get("NEO_FM_OFFLINE", "0") == "1",
        )
        self._device = (
            "cuda"
            if torch.cuda.is_available()
            else "mps"
            if getattr(torch.backends, "mps", None)
            and torch.backends.mps.is_available()
            else "cpu"
        )
        self._model = (
            AutoModel.from_pretrained(local_path, trust_remote_code=True)
            .to(self._device)
            .eval()
        )
        self._inference_mode = torch.inference_mode
        self._loaded = True

    def _resolve_reference(
        self, *, voice_id: str | None
    ) -> tuple[np.ndarray, int, str]:
        """Return (samples, sample_rate, source) for a voice_id.

        ``source`` is either ``"file"`` (a real WAV under
        ``ref_dir``) or ``"synthetic"`` (the deterministic
        in-process fallback). The synthetic path keeps unit tests
        + smoke runs operational even without the curated assets.
        """
        entry = get_voice(voice_id) if voice_id else None
        if entry is not None:
            wav_path = self._ref_dir / f"{entry.voice_id}.wav"
            if wav_path.exists():
                samples, sr = _read_wav_mono(wav_path)
                return samples, sr, "file"
            gender = entry.gender
        else:
            gender = "androgynous"
        return _synthetic_ref_wav(gender=gender), 24000, "synthetic"

    def synthesise(self, req: VocalRequest) -> bytes:
        if not self._loaded:
            raise RuntimeError("IndicF5Model.load() not called")

        sr = req.sample_rate
        chunks: list[np.ndarray] = []
        with self._inference_mode():
            for sec in req.sections:
                if sec.type == "instrumental" or not (
                    sec.lyrics or sec.transliteration
                ):
                    chunks.append(
                        np.zeros(int(sec.target_seconds * sr), dtype=np.float32)
                    )
                    continue
                text = sec.transliteration or sec.lyrics or ""
                ref_samples, ref_sr, _src = self._resolve_reference(
                    voice_id=sec.voice_id,
                )
                # The HuggingFace IndicF5 surface is `model(text=...,
                # ref_audio=..., ref_sr=..., language=...)`; we keep
                # the call shape narrow so a future model bump that
                # tweaks the signature only touches this method.
                stem = self._model(  # type: ignore[union-attr]
                    text=text,
                    ref_audio=ref_samples,
                    ref_sr=ref_sr,
                    language=sec.language or req.sections[0].language or "hi",
                )
                stem = np.asarray(stem, dtype=np.float32).squeeze()
                src_sr = 24000  # IndicF5 native
                if src_sr != sr and stem.size > 0:
                    ratio = sr / src_sr
                    new_n = int(stem.size * ratio)
                    idx = np.linspace(0, stem.size - 1, new_n).astype(np.int64)
                    stem = stem[idx]
                target_n = int(sec.target_seconds * sr)
                if stem.size < target_n:
                    stem = np.concatenate(
                        [stem, np.zeros(target_n - stem.size, dtype=np.float32)]
                    )
                else:
                    stem = stem[:target_n]
                chunks.append(stem)
        out = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
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


def _read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    """Read a 16-bit mono WAV without depending on soundfile.

    Mirrors the format produced by `_write_wav_mono` so CI fixtures
    written by the test harness round-trip cleanly.
    """
    import struct

    data = path.read_bytes()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError(f"{path}: not a RIFF/WAVE file")
    sample_rate = struct.unpack("<I", data[24:28])[0]
    bits = struct.unpack("<H", data[34:36])[0]
    if bits != 16:
        raise ValueError(f"{path}: expected 16-bit PCM, got {bits}-bit")
    # Find the "data" sub-chunk. The fmt sub-chunk is 16 bytes, but
    # newer encoders sometimes prepend a fact chunk, so we scan.
    idx = 12
    while idx + 8 < len(data):
        chunk_id = data[idx : idx + 4]
        chunk_size = struct.unpack("<I", data[idx + 4 : idx + 8])[0]
        if chunk_id == b"data":
            pcm = np.frombuffer(
                data[idx + 8 : idx + 8 + chunk_size], dtype=np.int16
            )
            return (pcm.astype(np.float32) / 32767.0).copy(), sample_rate
        idx += 8 + chunk_size
    raise ValueError(f"{path}: no data chunk")


__all__ = ["IndicF5Model"]
