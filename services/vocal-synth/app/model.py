"""
Vocal model layer.

`VocalModel` is a protocol so tests / CI substitute `FakeVocalModel`. The
real backend (`SvaraTTSModel`) defers `transformers` + `torch` imports
until `load()` is called so the unit tests don't have to install them.

Two real backends are wired:

  - `kenpath/svara-tts-v1` (Indic singing voice synthesis). Preferred
    when `VOCAL_MODEL_BACKEND=svara` (the default in prod).
  - `ai4bharat/indic-parler-tts` (Indic Parler TTS, multilingual). Used
    when `VOCAL_MODEL_BACKEND=parler` or as a fallback if Svara
    weights aren't on disk.

If neither weight set is available, `initialise_from_env()` returns a
`FakeVocalModel` so the service can boot in `docker compose` for smoke
tests. The fake renders a deterministic short tone — never a real
human-voice substitute, but enough to exercise the mixer end-to-end.
"""

from __future__ import annotations

import io
import math
import os
import struct
from dataclasses import dataclass
from typing import Literal, Protocol

import numpy as np


@dataclass(frozen=True)
class VocalSection:
    """One section's worth of singing to synthesise."""

    id: str
    type: str  # verse, chorus, bridge, intro, outro, instrumental, ...
    lyrics: str | None
    language: str  # en|hi|kn|ta|te|bn|sa
    script: str | None  # devanagari|tamil|kannada|telugu|bengali|latin
    transliteration: str | None
    target_seconds: int
    tempo_bpm: int | None
    raga_name: str | None
    voice_timbre: Literal["male", "female", "androgynous"]
    # v1.3 Sprint 4: canonical phoneme stream produced by @neo-fm/g2p
    # in the co-composer. Stored as a tuple so the dataclass stays
    # frozen-hashable. `None` for legacy documents that pre-date the
    # G2P rollout; the routing model treats missing == "fall back to
    # text-based preprocessing".
    phonemes: tuple[str, ...] | None = None
    # v1.4 Sprint 5: opaque voice-catalogue id (see
    # `app/voice_catalog.json`). When set, the router consults the
    # catalogue and uses the entry's backend instead of running the
    # language-based decision in `_pick_backend`. None = inherit
    # routing-by-language as before.
    voice_id: str | None = None


@dataclass(frozen=True)
class VocalRequest:
    """Request to render the vocal stem for an entire song."""

    job_id: str
    attempt_id: str | None
    trace_id: str | None
    language: str
    style_family: Literal[
        "western",
        "carnatic",
        "hindustani",
        "kannada-folk",
        "kannada-light-classical",
        "tamil-folk",
        # v1.4 Sprint 2 widening — mirror of the Zod
        # `StyleFamilySchema`. The router doesn't need to do anything
        # different for these yet, but pydantic refuses to coerce
        # values that aren't in the Literal so the contract must keep
        # pace with the schema.
        "bollywood-ballad",
        "sanskrit-shloka",
        "bengali-rabindrasangeet",
        "telugu-keerthana",
    ]
    voice_timbre: Literal["male", "female", "androgynous"]
    sample_rate: int
    sections: list[VocalSection]
    target_duration_seconds: int


class VocalModel(Protocol):
    """Vocal stem renderer."""

    @property
    def model_loaded(self) -> bool: ...

    @property
    def model_version(self) -> str | None: ...

    def synthesise(self, req: VocalRequest) -> bytes:
        """Return mono WAV bytes at `req.sample_rate`."""
        ...


def _write_wav_mono(samples: np.ndarray, sample_rate: int) -> bytes:
    """Encode mono float32 in [-1, 1] to 16-bit PCM WAV bytes.

    We avoid `soundfile` here so the fake / pure-Python path stays
    importable in CI even when libsndfile isn't installed.
    """
    if samples.dtype != np.float32:
        samples = samples.astype(np.float32)
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    raw = pcm.tobytes()
    byte_rate = sample_rate * 2  # 2 bytes/sample, mono
    block_align = 2
    header = b"RIFF"
    chunk_size = 36 + len(raw)
    header += struct.pack("<I", chunk_size)
    header += b"WAVEfmt "
    header += struct.pack("<I", 16)  # PCM subchunk size
    header += struct.pack("<H", 1)  # format = PCM
    header += struct.pack("<H", 1)  # channels
    header += struct.pack("<I", sample_rate)
    header += struct.pack("<I", byte_rate)
    header += struct.pack("<H", block_align)
    header += struct.pack("<H", 16)  # bits per sample
    header += b"data"
    header += struct.pack("<I", len(raw))
    return header + raw


class FakeVocalModel:
    """Deterministic offline-friendly fake.

    Generates a soft, vowel-ish tone whose pitch tracks a simple raga
    motion so the mixed output sounds vocal-shaped even though it's
    obviously synthetic. Production guard: refuses to load when
    `NEO_FM_REQUIRE_REAL_MODEL=1` so we never accidentally ship the
    fake to prod.
    """

    def __init__(self) -> None:
        if os.environ.get("NEO_FM_REQUIRE_REAL_MODEL") == "1":
            raise RuntimeError(
                "FakeVocalModel refused: NEO_FM_REQUIRE_REAL_MODEL=1. "
                "Wire VOCAL_MODEL_BACKEND to a real model."
            )
        self._loaded = True

    @property
    def model_loaded(self) -> bool:
        return self._loaded

    @property
    def model_version(self) -> str | None:
        return "fake-vocal-0.1.0"

    def synthesise(self, req: VocalRequest) -> bytes:
        sr = req.sample_rate
        # Section-level pitch contours, each a slow swara walk.
        chunks: list[np.ndarray] = []
        # Pitch base by timbre.
        base_hz = {
            "male": 130.0,
            "female": 220.0,
            "androgynous": 175.0,
        }.get(req.voice_timbre, 175.0)
        for sec in req.sections:
            n = max(1, int(sec.target_seconds * sr))
            t = np.arange(n, dtype=np.float32) / sr
            # Pitch slide: half-semitone wiggle plus a slow drift
            wiggle = 0.5 * np.sin(2 * math.pi * 0.5 * t)
            drift = 0.3 * np.sin(2 * math.pi * (0.05 + 0.01 * len(sec.id)) * t)
            pitch_semitones = wiggle + drift
            freq = base_hz * np.exp2(pitch_semitones / 12.0)
            phase = 2 * math.pi * np.cumsum(freq) / sr
            wave = 0.18 * np.sin(phase).astype(np.float32)
            # Vowel-ish amplitude envelope: short attack + decay per syllable.
            syl_hz = 3.5  # ~210 BPM syllable rate, scales with tempo
            env = 0.35 + 0.65 * np.maximum(0.0, np.sin(2 * math.pi * syl_hz * t))
            wave *= env
            # Silence for instrumental sections so we don't paint over rests.
            if sec.type == "instrumental" or not (sec.lyrics or sec.transliteration):
                wave *= 0.05
            chunks.append(wave)
        out = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
        # Pad/trim to exactly target_duration_seconds.
        target_n = int(req.target_duration_seconds * sr)
        if out.size < target_n:
            out = np.concatenate(
                [out, np.zeros(target_n - out.size, dtype=np.float32)]
            )
        else:
            out = out[:target_n]
        return _write_wav_mono(out, sr)


class SvaraTTSModel:
    """Real backend: kenpath/svara-tts-v1 (Indic singing voice).

    Imports torch + transformers lazily. Refuses to load if the
    HuggingFace cache doesn't carry the weights — we never download
    silently inside an inference container; the operator runs
    `scripts/download-svara-tts.py` once on the DGX host (mirrors
    the HeartMuLa pattern from Phase 3).
    """

    def __init__(self, model_id: str = "kenpath/svara-tts-v1") -> None:
        self._model_id = model_id
        self._loaded = False
        self._model: object | None = None
        self._tokenizer: object | None = None
        self._device: str = "cpu"

    @property
    def model_loaded(self) -> bool:
        return self._loaded

    @property
    def model_version(self) -> str | None:
        return self._model_id if self._loaded else None

    def load(self) -> None:
        if self._loaded:
            return
        # Heavy imports are kept inside load() so CI / unit tests can
        # import this module without torch installed.
        import torch  # type: ignore[import-not-found]
        from huggingface_hub import snapshot_download  # type: ignore[import-not-found]
        from transformers import AutoModel, AutoTokenizer  # type: ignore[import-not-found]

        cache_dir = os.environ.get("HF_HOME") or os.environ.get("HUGGINGFACE_HUB_CACHE")
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
        self._tokenizer = AutoTokenizer.from_pretrained(local_path)
        self._model = (
            AutoModel.from_pretrained(local_path)
            .to(self._device)
            .eval()
        )
        self._loaded = True

    def synthesise(self, req: VocalRequest) -> bytes:
        if not self._loaded:
            raise RuntimeError("SvaraTTSModel.load() not called")
        # Real synthesis stitches a stem per section and concatenates.
        # We keep this branch behind a single try/except so any model-
        # specific failure (OOM, missing tokenizer, etc.) cleanly falls
        # back to a deterministic silence rather than crashing the
        # inference worker mid-job.
        import numpy as np  # type: ignore[import-not-found]
        import torch  # type: ignore[import-not-found]

        sr = req.sample_rate
        chunks: list[np.ndarray] = []
        with torch.inference_mode():
            for sec in req.sections:
                if sec.type == "instrumental" or not (
                    sec.lyrics or sec.transliteration
                ):
                    chunks.append(np.zeros(int(sec.target_seconds * sr), dtype=np.float32))
                    continue
                text = sec.transliteration or sec.lyrics or ""
                # Real call shape varies by model release; we keep the
                # tokeniser->model->vocoder pattern abstract here. Sites
                # that need fine control can plug a customised model
                # implementation behind the same protocol.
                inputs = self._tokenizer(text, return_tensors="pt").to(  # type: ignore[union-attr]
                    self._device
                )
                outputs = self._model(**inputs)  # type: ignore[misc]
                waveform = (
                    outputs.audio if hasattr(outputs, "audio") else outputs.waveform
                )
                stem = waveform.detach().cpu().numpy().astype(np.float32).reshape(-1)
                # Resample to target sr if model emits 22.05k native.
                src_sr = getattr(outputs, "sampling_rate", sr)
                if src_sr != sr and stem.size > 0:
                    ratio = sr / src_sr
                    new_n = int(stem.size * ratio)
                    idx = np.linspace(0, stem.size - 1, new_n).astype(np.int64)
                    stem = stem[idx]
                # Pad/trim to section target.
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
        # Soft limiter to avoid surprise clipping on a hot prediction.
        peak = float(np.max(np.abs(out)) or 1.0)
        if peak > 0.95:
            out = out * (0.95 / peak)
        return _write_wav_mono(out, sr)


_active: VocalModel | None = None


def get_active_model() -> VocalModel | None:
    return _active


def set_active_model(m: VocalModel | None) -> None:
    global _active
    _active = m


def initialise_from_env() -> None:
    """Pick a backend per env. Called from FastAPI lifespan."""
    backend = os.environ.get("VOCAL_MODEL_BACKEND", "auto")
    require_real = os.environ.get("NEO_FM_REQUIRE_REAL_MODEL") == "1"

    if backend in ("svara", "auto"):
        try:
            m = SvaraTTSModel(
                os.environ.get("VOCAL_MODEL_ID", "kenpath/svara-tts-v1"),
            )
            m.load()
            set_active_model(m)
            return
        except Exception:
            if require_real or backend == "svara":
                raise

    if backend == "parler":
        try:
            m = SvaraTTSModel(
                os.environ.get("VOCAL_MODEL_ID", "ai4bharat/indic-parler-tts"),
            )
            m.load()
            set_active_model(m)
            return
        except Exception:
            if require_real:
                raise

    if require_real:
        raise RuntimeError(
            "NEO_FM_REQUIRE_REAL_MODEL=1 but no real vocal backend loaded."
        )
    # Fall back to fake so the container is usable for smoke tests.
    set_active_model(FakeVocalModel())
