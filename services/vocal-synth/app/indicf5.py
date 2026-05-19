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
        # torch or f5_tts.
        import torch  # type: ignore[import-not-found]
        from huggingface_hub import snapshot_download  # type: ignore[import-not-found]

        try:
            from f5_tts.infer.utils_infer import load_vocoder  # type: ignore[import-not-found]
        except ImportError as e:
            raise RuntimeError(
                "f5_tts is not installed. Run: uv pip install f5-tts pydub"
            ) from e

        cache_dir = os.environ.get("HF_HOME") or os.environ.get(
            "HUGGINGFACE_HUB_CACHE"
        )
        offline = os.environ.get("NEO_FM_OFFLINE", "0") == "1"
        local_path = Path(
            snapshot_download(
                self._model_id,
                cache_dir=cache_dir,
                local_files_only=offline,
            )
        )
        self._device = (
            "cuda"
            if torch.cuda.is_available()
            else "mps"
            if getattr(torch.backends, "mps", None)
            and torch.backends.mps.is_available()
            else "cpu"
        )
        # IndicF5's custom model.py calls load_model() without ckpt_path,
        # which is broken against f5_tts>=0.3. Bypass AutoModel and build
        # the pipeline directly.
        #
        # The IndicF5 safetensors was saved from a torch.compile()-wrapped
        # model, so all keys carry an "_orig_mod." prefix that
        # load_checkpoint doesn't strip. We load it manually:
        #   1. Build the unweighted CFM model via load_model with a dummy path.
        #   2. Load safetensors, strip "_orig_mod.", inject as state_dict.
        from f5_tts.infer.utils_infer import get_tokenizer  # type: ignore[import-not-found]
        from f5_tts.model.backbones.dit import DiT as _DiT  # type: ignore[import-not-found]
        from f5_tts.model.cfm import CFM  # type: ignore[import-not-found]
        from safetensors.torch import (
            load_file as _load_safetensors,  # type: ignore[import-not-found]
        )

        vocab_path = str(local_path / "checkpoints" / "vocab.txt")
        safetensors_path = str(local_path / "model.safetensors")

        vocab_char_map, vocab_size = get_tokenizer(vocab_path, "custom")
        n_mel = 100  # vocos mel channels
        ema_model_inner = CFM(
            transformer=_DiT(
                dim=1024, depth=22, heads=16, ff_mult=2,
                text_dim=512, conv_layers=4,
                text_num_embeds=vocab_size, mel_dim=n_mel,
            ),
            mel_spec_kwargs=dict(
                n_fft=1024, hop_length=256, win_length=1024,
                n_mel_channels=n_mel, target_sample_rate=24000,
                mel_spec_type="vocos",
            ),
            odeint_kwargs=dict(method="euler"),
            vocab_char_map=vocab_char_map,
        ).to(self._device)

        raw_sd = _load_safetensors(safetensors_path, device=self._device)
        # Strip torch.compile() "_orig_mod." prefix if present.
        stripped_sd = {
            (k[len("_orig_mod."):] if k.startswith("_orig_mod.") else k): v
            for k, v in raw_sd.items()
        }
        ema_model_inner.load_state_dict(stripped_sd, strict=False)
        ema_model_inner.eval()

        vocoder = torch.compile(
            load_vocoder(vocoder_name="vocos", is_local=False, device=self._device)
        )
        ema_model = torch.compile(ema_model_inner)
        # synthesise() calls model(text=..., ref_audio=np.ndarray, ref_sr=int, language=str).
        # f5_tts's infer_process needs a preprocessed tuple, not a numpy array.
        # This wrapper bridges the two: it writes the numpy ref to a temp WAV,
        # runs preprocess_ref_audio_text, then calls infer_process.
        import tempfile as _tempfile

        class _INF5Wrapper:
            def __init__(self, ema: object, voc: object, dev: str) -> None:
                self.ema_model = ema
                self.vocoder = voc
                self._device = dev

            def __call__(
                self,
                *,
                text: str,
                ref_audio: np.ndarray,
                ref_sr: int,
                language: str,  # passed by routing; f5_tts infers from ref
                ref_text: str = "Reference audio.",
            ) -> np.ndarray:
                import soundfile as _sf  # type: ignore[import-not-found]
                import torch as _torch
                from f5_tts.infer.utils_infer import (  # type: ignore[import-not-found]
                    chunk_text,
                    infer_batch_process,
                )
                # Resample ref_audio to 24kHz (IndicF5 native) and write as WAV.
                # soundfile can read it without system FFmpeg (unlike torchaudio).
                target_sr = 24000
                if ref_sr != target_sr:
                    ratio = target_sr / ref_sr
                    new_len = int(len(ref_audio) * ratio)
                    ref_audio = np.interp(
                        np.linspace(0, len(ref_audio) - 1, new_len),
                        np.arange(len(ref_audio)),
                        ref_audio,
                    ).astype(np.float32)
                with _tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
                    _sf.write(tmp.name, ref_audio, target_sr)
                    ref_data, _sr_check = _sf.read(tmp.name, dtype="float32")
                # Convert to shape (1, T) tensor as torchaudio would produce.
                audio_tensor = _torch.from_numpy(ref_data).unsqueeze(0).to(self._device)
                # Bypass infer_process (uses torchaudio.load → torchcodec → ffmpeg).
                # Call infer_batch_process directly with the tensor.
                speed = 1.0
                max_chars = max(
                    1,
                    int(
                        len(ref_text.encode("utf-8"))
                        / (audio_tensor.shape[-1] / target_sr)
                        * (22 - audio_tensor.shape[-1] / target_sr)
                        * speed
                    ),
                )
                gen_text_batches = chunk_text(text, max_chars=max_chars)
                if not gen_text_batches:
                    return np.zeros(target_sr, dtype=np.float32)
                result_wav, _out_sr, _ = next(
                    infer_batch_process(
                        (audio_tensor, target_sr),
                        ref_text,
                        gen_text_batches,
                        self.ema_model,
                        self.vocoder,
                        mel_spec_type="vocos",
                        device=self._device,
                    )
                )
                return np.asarray(result_wav, dtype=np.float32)

        self._model = _INF5Wrapper(ema_model, vocoder, self._device)
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
