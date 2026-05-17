"""MusicGen-Medium wrapper for `services/music-inference` — v1.4 Sprint 10.

This module is the only place that imports `audiocraft`. The wrapper
mirrors `HeartMuLaModel`'s shape so the FastAPI layer can swap backends
behind a single `MusicModel` protocol — no surface changes to /v1/generate.

Inference path:
  - `MusicGenModel.load()` pulls `facebook/musicgen-medium` (1.5 B
    params) onto the GPU at BF16, ~6 GB VRAM.
  - For each request, we build a text prompt (style + raga + tala +
    instrumentation) from the SongDocument, optionally attach a
    per-style LoRA adapter via PEFT, and call `model.generate()`.
  - We trim/pad the resulting waveform to `target_duration_seconds`
    and serialise to WAV via `audiocraft.data.audio.audio_write`.

LoRA adapters are loaded from local paths registered via the
`MUSICGEN_LORA_<STYLE>` env-var convention (mirrors HeartMuLa's
`HEARTMULA_LORA_<STYLE>`). Per-style adapter lifecycle is identical:
attach on request, detach in `finally`, cache loaded adapter names.

Sprint 10 ships:
  - This module.
  - The `RoutingMusicModel` (in `routing.py`) that A/B-routes between
    HeartMuLa and MusicGen on `style_family`.
  - Curation + training scripts for two adapters
    (`neo-fm/musicgen-carnatic-lora-v1`, `neo-fm/musicgen-hindustani-lora-v1`)
    that go to HF Hub after the MOS gate clears.

References:
- AudioCraft: https://github.com/facebookresearch/audiocraft
- LoRA-on-MusicGen recipe pulled from chavinlo/musicgen_trainer.
- ADR 0030.
"""

from __future__ import annotations

import contextlib
import io
import logging
import os
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.model import GenerationRequest, build_tags_block

LOG = logging.getLogger("music-inference.musicgen")


# v1.4 Sprint 10: per-style adapter discovery from env. Same pattern as
# HeartMuLa's `_STYLE_ADAPTER_ENV` so an operator can flip a single env
# var to test a new adapter without redeploying.
_STYLE_ADAPTER_ENV: dict[str, str] = {
    "western": "MUSICGEN_LORA_WESTERN",
    "carnatic": "MUSICGEN_LORA_CARNATIC",
    "hindustani": "MUSICGEN_LORA_HINDUSTANI",
    "kannada-folk": "MUSICGEN_LORA_KANNADA_FOLK",
    "kannada-light-classical": "MUSICGEN_LORA_KANNADA_LIGHT_CLASSICAL",
    "tamil-folk": "MUSICGEN_LORA_TAMIL_FOLK",
    "bollywood-ballad": "MUSICGEN_LORA_BOLLYWOOD_BALLAD",
    "sanskrit-shloka": "MUSICGEN_LORA_SANSKRIT_SHLOKA",
    "bengali-rabindrasangeet": "MUSICGEN_LORA_BENGALI_RABINDRASANGEET",
    "telugu-keerthana": "MUSICGEN_LORA_TELUGU_KEERTHANA",
}


def style_adapters_from_env() -> dict[str, Path]:
    """Read the documented `MUSICGEN_LORA_<STYLE>` env vars into a
    `style_family → adapter path` mapping. Unset vars are dropped.
    """
    out: dict[str, Path] = {}
    for style, env_var in _STYLE_ADAPTER_ENV.items():
        value = os.environ.get(env_var)
        if not value:
            continue
        out[style] = Path(value)
    return out


def build_musicgen_prompt(req: GenerationRequest) -> str:
    """Translate a SongDocument-shaped request into a MusicGen text
    prompt.

    MusicGen consumes a single free-text description; we layer:
      - the style/genre seed tag set (from `build_tags_block`)
      - the raga + system (e.g. "raga yamuna-kalyani, carnatic")
      - the tala + tempo
      - the dominant instrumentation tag

    Keep the prompt single-line; MusicGen tokenises the whole string
    and longer prompts dilute the conditioning signal.
    """
    tags = build_tags_block(req)
    parts: list[str] = []
    if tags:
        parts.append(tags.replace(",", ", "))
    if req.tala:
        parts.append(f"tala {req.tala}")
    if req.tempo_bpm:
        parts.append(f"{req.tempo_bpm} bpm")
    if req.time_signature:
        parts.append(f"in {req.time_signature}")
    return ", ".join(parts)


@dataclass(frozen=True)
class MusicGenInferenceParams:
    """Decode-time params; defaults align with the audiocraft README
    medium-quality settings, plus a small CFG bump that the operator
    can tune via env."""
    duration_max_seconds: float = 30.0
    top_k: int = 250
    top_p: float = 0.0
    temperature: float = 1.0
    cfg_coef: float = 3.5
    two_step_cfg: bool = False


class MusicGenModel:
    """MusicGen-Medium pipeline with optional per-style LoRA adapters.

    Lazy-imports `audiocraft` + `torch` + `peft` so the CI / dev path
    never has to install GPU deps.
    """

    def __init__(
        self,
        *,
        device: str = "cuda",
        dtype: str = "bfloat16",
        weights_repo: str = "facebook/musicgen-medium",
        style_adapters: dict[str, Path] | None = None,
        params: MusicGenInferenceParams | None = None,
    ) -> None:
        self._device = device
        self._dtype = dtype
        self._weights_repo = weights_repo
        self._params = params or MusicGenInferenceParams()
        self._style_adapters: dict[str, Path] = dict(style_adapters or {})
        self._loaded_adapter_names: set[str] = set()
        self._mg: Any = None
        self.model_loaded: bool = False
        self.model_version: str | None = None

    def load(self) -> None:
        """Eager GPU load. Same TRIZ C2 rationale as HeartMuLa."""
        import torch  # type: ignore[import-not-found]
        from audiocraft.models import MusicGen  # type: ignore[import-not-found]

        dtype_map = {
            "float32": torch.float32,
            "bfloat16": torch.bfloat16,
            "float16": torch.float16,
        }
        LOG.info(
            "loading MusicGen",
            extra={
                "extra_fields": {
                    "weights_repo": self._weights_repo,
                    "device": self._device,
                    "dtype": self._dtype,
                    "style_adapters": sorted(self._style_adapters),
                }
            },
        )
        self._mg = MusicGen.get_pretrained(self._weights_repo, device=self._device)
        # audiocraft pins its internal dtype; we still set it on the
        # wrapped LM for adapter compatibility.
        if hasattr(self._mg, "lm"):
            self._mg.lm.to(dtype=dtype_map.get(self._dtype, torch.bfloat16))
        # default generation params
        self._mg.set_generation_params(
            duration=self._params.duration_max_seconds,
            top_k=self._params.top_k,
            top_p=self._params.top_p,
            temperature=self._params.temperature,
            cfg_coef=self._params.cfg_coef,
            two_step_cfg=self._params.two_step_cfg,
        )
        self.model_loaded = True
        self.model_version = f"musicgen-medium-{self._weights_repo.split('/')[-1]}"

    def has_adapter_for(self, style_family: str) -> bool:
        return style_family in self._style_adapters

    def adapter_name_for(self, style_family: str) -> str:
        path = self._style_adapters[style_family]
        return path.name or style_family

    def _attach_adapter(self, style_family: str) -> str | None:
        path = self._style_adapters.get(style_family)
        if path is None:
            return None
        if not path.exists():
            raise RuntimeError(
                f"MusicGen LoRA adapter for style_family={style_family!r} "
                f"does not exist on disk: {path}. Run "
                f"`train_musicgen_lora.py --push-to-hub` and download "
                f"the adapter."
            )
        if not hasattr(self._mg, "lm"):
            raise RuntimeError(
                "MusicGen pipeline has no `.lm` attribute; cannot "
                "attach a LoRA adapter."
            )
        adapter_name = self.adapter_name_for(style_family)
        inner = self._mg.lm
        if adapter_name not in self._loaded_adapter_names:
            if hasattr(inner, "load_adapter"):
                inner.load_adapter(str(path), adapter_name=adapter_name)
            else:
                from peft import PeftModel  # type: ignore[import-not-found]

                self._mg.lm = PeftModel.from_pretrained(
                    inner, str(path), adapter_name=adapter_name
                )
            self._loaded_adapter_names.add(adapter_name)
        if hasattr(self._mg.lm, "set_adapter"):
            self._mg.lm.set_adapter(adapter_name)
        return adapter_name

    def _detach_adapter(self) -> None:
        if self._mg is None or not hasattr(self._mg, "lm"):
            return
        inner = self._mg.lm
        if hasattr(inner, "disable_adapters"):
            with contextlib.suppress(Exception):
                inner.disable_adapters()

    def generate(self, req: GenerationRequest) -> bytes:
        if not self.model_loaded or self._mg is None:
            raise RuntimeError("MusicGenModel.generate called before load()")

        import torch  # type: ignore[import-not-found]

        # MusicGen tops out at 30s per generation in the medium model;
        # for longer targets we will need to stitch (Sprint 11
        # transitions handle this for stems). Clip duration cleanly.
        target_seconds = min(
            float(req.target_duration_seconds),
            float(self._params.duration_max_seconds),
        )
        self._mg.set_generation_params(
            duration=target_seconds,
            top_k=self._params.top_k,
            top_p=self._params.top_p,
            temperature=self._params.temperature,
            cfg_coef=self._params.cfg_coef,
            two_step_cfg=self._params.two_step_cfg,
        )

        prompt = build_musicgen_prompt(req)
        active = self._attach_adapter(req.style_family)
        try:
            with torch.no_grad():
                wav = self._mg.generate([prompt], progress=False)
            # wav: torch.Tensor shape (1, channels, n_samples)
            audio = _tensor_to_wav(wav, sample_rate=self._mg.sample_rate)
        finally:
            if active is not None:
                self._detach_adapter()

        return audio


def _tensor_to_wav(wav: Any, *, sample_rate: int) -> bytes:  # pragma: no cover
    """Pull the first channel from MusicGen's output and serialise to a
    16-bit PCM WAV. Lazy-imports `numpy` so CI doesn't need it.
    """
    import numpy as np  # type: ignore[import-not-found]

    arr = wav[0].cpu().to(dtype=__import__("torch").float32).numpy()
    if arr.ndim == 2:
        # mix down to mono for now; Sprint 11 owns multi-stem mixing.
        arr = arr.mean(axis=0)
    # Normalise to int16
    arr = np.clip(arr, -1.0, 1.0)
    pcm = (arr * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


__all__ = [
    "MusicGenInferenceParams",
    "MusicGenModel",
    "build_musicgen_prompt",
    "style_adapters_from_env",
]
