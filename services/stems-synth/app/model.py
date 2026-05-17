"""Stable Audio Open stems-synth model layer (v1.4 Sprint 11).

This module owns:

  - The `StemModel` Protocol the FastAPI layer calls into.
  - `FakeStemModel` — CI/dev double that returns a tagged short silent
    WAV at 44.1 kHz so the rest of the worker stack can exercise the
    stem-insert mixer path without a GPU.
  - `StableAudioOpenStemModel` (DGX) — wraps the `stable-audio-tools`
    pipeline, lazy-imports torch/diffusers, supports an optional
    rank-16 short-clip LoRA via PEFT.
  - `STEM_PRESETS` — a curated dictionary of preset stems with their
    text prompt + default duration. The worker picks a preset id; the
    sidecar resolves the prompt + duration server-side so the prompt
    engineering stays in one place.

The contract is intentionally identical in shape to the other Sprint-
7+10 sidecars: there is exactly one inference helper (`generate`)
returning bytes, plus a `model_loaded` / `model_version` / `backend`
trio for the health endpoint.

References:
- Stable Audio Open: https://huggingface.co/stabilityai/stable-audio-open-1.0
- stable-audio-tools: https://github.com/Stability-AI/stable-audio-tools
- ADR 0031 (v1.4 Sprint 11).
"""

from __future__ import annotations

import contextlib
import io
import logging
import os
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol

LOG = logging.getLogger("stems-synth.model")


# Sprint 11 preset library. Each entry has:
#   - `prompt`: the free-text description fed to Stable Audio Open.
#   - `duration_seconds`: default duration; the wire request may override
#     within [1.0, 12.0].
#   - `gain`: per-preset default mix gain (the worker can override).
# Naming convention: `{instrument}_{style|move}`. New presets land
# here + in tests + in the ADR table.
STEM_PRESETS: dict[str, dict[str, Any]] = {
    "tabla_tihai": {
        "prompt": (
            "Solo tabla tihai, 8 beats, dha-tin-tin pattern, "
            "Hindustani classical, close mic, dry room"
        ),
        "duration_seconds": 6.0,
        "gain": 0.9,
        "style_families": ["hindustani", "bollywood-ballad"],
    },
    "mridangam_korvai": {
        "prompt": (
            "Mridangam korvai phrase, Carnatic concert recording, "
            "warm bass-side, finger taps on right head, "
            "studio-clean, 8 beat cycle"
        ),
        "duration_seconds": 7.0,
        "gain": 0.9,
        "style_families": ["carnatic", "telugu-keerthana"],
    },
    "parai_break": {
        "prompt": (
            "Tamil parai drum break, double-stick hits, energetic, "
            "outdoor festival recording, prominent overtones"
        ),
        "duration_seconds": 5.0,
        "gain": 1.0,
        "style_families": ["tamil-folk"],
    },
    "harmonium_interlude": {
        "prompt": (
            "Bhavageete harmonium interlude, gentle reed swell, "
            "Kannada light-classical, intimate studio mic"
        ),
        "duration_seconds": 6.0,
        "gain": 0.85,
        "style_families": ["kannada-light-classical", "kannada-folk"],
    },
    "tanpura_drone": {
        "prompt": (
            "Tanpura drone in C, sustained, no rhythm, "
            "spacious natural reverb, devotional ambience"
        ),
        "duration_seconds": 10.0,
        "gain": 0.6,
        "style_families": [
            "sanskrit-shloka",
            "hindustani",
            "carnatic",
            "kannada-light-classical",
        ],
    },
    "shloka_bell_open": {
        "prompt": (
            "Single temple bell strike with long decay, "
            "incense-room ambience, Sanskrit shloka opening"
        ),
        "duration_seconds": 4.0,
        "gain": 0.7,
        "style_families": ["sanskrit-shloka"],
    },
    "esraj_swell": {
        "prompt": (
            "Esraj sustained swell, Rabindrasangeet, expressive vibrato, "
            "Bengali devotional, mid-tempo"
        ),
        "duration_seconds": 6.0,
        "gain": 0.85,
        "style_families": ["bengali-rabindrasangeet"],
    },
    "nadaswaram_flourish": {
        "prompt": (
            "Nadaswaram melodic flourish, Tamil temple music, "
            "bright reed, open-air, ceremonial"
        ),
        "duration_seconds": 5.0,
        "gain": 0.9,
        "style_families": ["tamil-folk", "carnatic"],
    },
}


@dataclass(frozen=True)
class StemRequest:
    """Pure-data view of a `/v1/generate-stem` call.

    Exactly one of (`preset`, `prompt`) must be set; the FastAPI layer
    enforces the invariant before constructing this. When `preset` is
    set, the worker leaves prompt building to the sidecar — that's the
    whole point of a preset.
    """
    job_id: str
    attempt_id: str | None
    style_family: str
    preset: str | None
    prompt: str | None
    duration_seconds: float
    seed: int | None = None
    decode_steps: int = 50
    cfg_scale: float = 6.0


@dataclass(frozen=True)
class StemResponse:
    """What `StemModel.generate` returns plus the metadata the FastAPI
    layer emits on the response headers / log line."""
    audio: bytes
    backend: str
    model_version: str
    duration_seconds: float
    sample_rate: int = 44100
    decode_params: dict[str, Any] = field(default_factory=dict)


class StemModel(Protocol):
    model_loaded: bool
    model_version: str | None
    backend: str

    def generate(self, req: StemRequest) -> StemResponse: ...


# --- preset resolution ------------------------------------------------------


def resolve_prompt(
    *, preset: str | None, prompt: str | None, style_family: str
) -> tuple[str, float]:
    """Turn a (preset, prompt, style) triple into (prompt_text,
    duration_seconds).

    - If `preset` is set, look it up in STEM_PRESETS; raise on unknown.
    - Else use `prompt` verbatim with a sensible 6s default duration.
    - When both are None, raise (the FastAPI layer should have caught
      it at validation time, but defense in depth).

    Style-family is recorded for future filtering — Sprint 16's eval
    may use it to keep `parai_break` out of a Hindustani context —
    but for v1.4 we trust the operator's preset list.
    """
    del style_family  # reserved for Sprint 16 style-gating
    if preset is not None:
        if preset not in STEM_PRESETS:
            raise ValueError(
                f"Unknown stem preset {preset!r}; valid presets: "
                f"{sorted(STEM_PRESETS)}"
            )
        entry = STEM_PRESETS[preset]
        return str(entry["prompt"]), float(entry["duration_seconds"])
    if prompt is not None:
        text = prompt.strip()
        if not text:
            raise ValueError("free-text prompt must be non-empty")
        return text, 6.0
    raise ValueError("Either preset or prompt must be provided")


def preset_applies_to_style(preset: str, style_family: str) -> bool:
    """Allow a worker-side guard so a misconfigured preset request for
    a mismatched style still resolves cleanly. Operators see a warning
    log but the call still serves audio."""
    entry = STEM_PRESETS.get(preset)
    if entry is None:
        return False
    styles = entry.get("style_families", [])
    return style_family in styles


# --- production model -------------------------------------------------------


class StableAudioOpenStemModel:
    """Stable Audio Open 1.0 + optional rank-16 short-clip LoRA.

    Lazy-imports `stable_audio_tools` + torch + peft so the CI path
    never has to install GPU deps.
    """

    backend: Literal["stable-audio-open"] = "stable-audio-open"

    def __init__(
        self,
        *,
        device: str = "cuda",
        dtype: str = "float16",
        weights_repo: str = "stabilityai/stable-audio-open-1.0",
        lora_path: Path | None = None,
        sample_rate: int = 44100,
    ) -> None:
        self._device = device
        self._dtype = dtype
        self._weights_repo = weights_repo
        self._lora_path = lora_path
        self._sample_rate = sample_rate
        self._pipeline: Any = None
        self._lora_attached: bool = False
        self.model_loaded: bool = False
        self.model_version: str | None = None

    def load(self) -> None:  # pragma: no cover - DGX-only
        import torch  # type: ignore[import-not-found]
        from stable_audio_tools import (  # type: ignore[import-not-found]
            get_pretrained_model,
        )

        dtype_map = {
            "float32": torch.float32,
            "bfloat16": torch.bfloat16,
            "float16": torch.float16,
        }
        LOG.info(
            "loading stable-audio-open",
            extra={
                "extra_fields": {
                    "weights_repo": self._weights_repo,
                    "device": self._device,
                    "dtype": self._dtype,
                    "lora_path": str(self._lora_path) if self._lora_path else None,
                }
            },
        )
        self._pipeline, _ = get_pretrained_model(self._weights_repo)
        self._pipeline = self._pipeline.to(
            device=self._device, dtype=dtype_map.get(self._dtype, torch.float16)
        )
        if self._lora_path is not None:
            self._attach_lora(self._lora_path)
        self.model_loaded = True
        self.model_version = (
            f"stable-audio-open-{self._weights_repo.split('/')[-1]}"
            + (f"+lora-{self._lora_path.name}" if self._lora_path else "")
        )

    def _attach_lora(self, path: Path) -> None:  # pragma: no cover
        if not path.exists():
            raise RuntimeError(
                f"Stable Audio LoRA at {path} does not exist; "
                f"run scripts/train_stems_lora.py --push-to-hub and pull."
            )
        from peft import PeftModel  # type: ignore[import-not-found]

        # stable-audio-tools pipelines expose the conditioning DiT as
        # `.model.model.diffusion_model` (per their inference scripts).
        # We attach the adapter on the diffusion transformer.
        inner = self._pipeline
        for attr in ("model", "model", "diffusion_model"):
            inner = getattr(inner, attr, None)
            if inner is None:
                raise RuntimeError(
                    "Could not navigate to the diffusion model layer; "
                    "stable-audio-tools may have moved its API."
                )
        wrapped = PeftModel.from_pretrained(
            inner, str(path), adapter_name="stems-v1"
        )
        # Replace the inner reference in-place. Pre-condition: the
        # outer pipeline holds a Python reference to `inner`; we
        # overwrite that reference.
        pl = self._pipeline.model.model
        pl.diffusion_model = wrapped
        self._lora_attached = True

    def generate(self, req: StemRequest) -> StemResponse:  # pragma: no cover
        if not self.model_loaded or self._pipeline is None:
            raise RuntimeError(
                "StableAudioOpenStemModel.generate called before load()"
            )
        import torch  # type: ignore[import-not-found]
        from stable_audio_tools.inference.generation import (  # type: ignore[import-not-found]
            generate_diffusion_cond,
        )

        prompt_text, duration_seconds = resolve_prompt(
            preset=req.preset,
            prompt=req.prompt,
            style_family=req.style_family,
        )
        duration_seconds = max(1.0, min(12.0, req.duration_seconds or duration_seconds))

        seed = req.seed if req.seed is not None else int.from_bytes(os.urandom(4), "little")
        with torch.no_grad():
            audio = generate_diffusion_cond(
                self._pipeline,
                steps=req.decode_steps,
                cfg_scale=req.cfg_scale,
                conditioning=[{"prompt": prompt_text, "seconds_total": duration_seconds}],
                sample_size=int(self._sample_rate * duration_seconds),
                sigma_min=0.3,
                sigma_max=500,
                sampler_type="dpmpp-3m-sde",
                device=self._device,
                seed=seed,
            )
        wav = _tensor_to_wav(audio, sample_rate=self._sample_rate)
        return StemResponse(
            audio=wav,
            backend=self.backend,
            model_version=self.model_version or "unknown",
            duration_seconds=duration_seconds,
            sample_rate=self._sample_rate,
            decode_params={
                "steps": req.decode_steps,
                "cfg_scale": req.cfg_scale,
                "seed": seed,
            },
        )


def _tensor_to_wav(audio: Any, *, sample_rate: int) -> bytes:  # pragma: no cover
    """Serialise a (channels, samples) float tensor to 16-bit PCM WAV."""
    import numpy as np  # type: ignore[import-not-found]

    arr = audio.squeeze().to(dtype=__import__("torch").float32).cpu().numpy()
    if arr.ndim == 2:
        # mono-mix; the mixer expects mono input
        arr = arr.mean(axis=0)
    arr = np.clip(arr, -1.0, 1.0)
    pcm = (arr * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


# --- test double ------------------------------------------------------------


class FakeStemModel:
    """Deterministic 1s silent WAV; CI/dev only.

    Records the last request so tests can assert on prompt resolution.
    """

    backend: Literal["fake"] = "fake"

    def __init__(self, version: str = "fake-1.0") -> None:
        self.model_loaded: bool = True
        self.model_version: str | None = version
        self.last_request: StemRequest | None = None
        self.last_prompt: str | None = None
        self.last_duration: float | None = None

    def generate(self, req: StemRequest) -> StemResponse:
        self.last_request = req
        prompt_text, duration = resolve_prompt(
            preset=req.preset,
            prompt=req.prompt,
            style_family=req.style_family,
        )
        self.last_prompt = prompt_text
        # Caller can override the preset duration via request.
        duration = max(1.0, min(12.0, req.duration_seconds or duration))
        self.last_duration = duration
        return StemResponse(
            audio=_silent_wav(duration_seconds=duration, sample_rate=44100),
            backend=self.backend,
            model_version=self.model_version or "fake-1.0",
            duration_seconds=duration,
            sample_rate=44100,
            decode_params={"steps": req.decode_steps, "cfg_scale": req.cfg_scale},
        )


def _silent_wav(*, duration_seconds: float, sample_rate: int) -> bytes:
    n = int(sample_rate * duration_seconds)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * n)
    return buf.getvalue()


# --- module-level singleton + env wiring ------------------------------------

_active_model: StemModel | None = None


def set_active_model(model: StemModel | None) -> None:
    global _active_model
    _active_model = model


def get_active_model() -> StemModel | None:
    return _active_model


def initialise_from_env() -> StemModel:
    """Build the model the env asks for.

    - `STEMS_SYNTH_FAKE_MODEL=1` + `STEMS_SYNTH_ALLOW_FAKE=1` → FakeStemModel.
    - else → StableAudioOpenStemModel.
    """
    if os.environ.get("STEMS_SYNTH_FAKE_MODEL") == "1":
        if os.environ.get("STEMS_SYNTH_ALLOW_FAKE") != "1":
            raise RuntimeError(
                "STEMS_SYNTH_FAKE_MODEL=1 was set but "
                "STEMS_SYNTH_ALLOW_FAKE=1 was not. Refusing to install "
                "FakeStemModel: this would serve deterministic silence "
                "to real users. Set both env vars to opt in (CI/test)."
            )
        LOG.warning(
            "STEMS_SYNTH_FAKE_MODEL=1 + STEMS_SYNTH_ALLOW_FAKE=1 — "
            "serving deterministic silence (CI/test mode)"
        )
        m: StemModel = FakeStemModel()
        set_active_model(m)
        return m

    lora_path_str = os.environ.get("STEMS_SYNTH_LORA_PATH", "")
    real = StableAudioOpenStemModel(
        device=os.environ.get("STEMS_SYNTH_DEVICE", "cuda"),
        dtype=os.environ.get("STEMS_SYNTH_DTYPE", "float16"),
        weights_repo=os.environ.get(
            "STEMS_SYNTH_WEIGHTS", "stabilityai/stable-audio-open-1.0"
        ),
        lora_path=Path(lora_path_str) if lora_path_str else None,
    )
    if os.environ.get("STEMS_SYNTH_DEFER_LOAD") != "1":
        real.load()
    set_active_model(real)
    return real


@contextlib.contextmanager
def override_model(model: StemModel):  # type: ignore[no-untyped-def]
    previous = get_active_model()
    try:
        set_active_model(model)
        yield model
    finally:
        set_active_model(previous)
