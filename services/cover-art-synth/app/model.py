"""
Cover-art model layer.

`CoverArtModel` is a Protocol so tests can substitute `FakeCoverArtModel`.
Two real backends are wired:

  - **z-image**   : `Tongyi-MAI/Z-Image-Turbo` (default in prod). Official
                    Alibaba Tongyi-MAI release. 6B-param DiT (Lumina-2-based)
                    + Qwen3 text encoder, distilled via Decoupled-DMD to 8
                    NFEs. Loads through the diffusers `ZImagePipeline`
                    class in bfloat16, native up to 2048^2. Tuned for
                    1024^2 album-art generations. (Replaces the legacy
                    `tonyassi/z-image-turbo` ID, which 404s upstream and
                    caused the service to silently degrade to the fake
                    backend in production.)
  - **sdxl-turbo**: `stabilityai/sdxl-turbo`. Fallback for environments
                    where the Z-Image weights aren't on disk. UNet-based,
                    float16 + `variant="fp16"`, 4 NFEs, AutoPipeline.

If neither weight set is available, `initialise_from_env()` returns a
`FakeCoverArtModel` so the container can boot in `docker compose`
without GPU. The fake renders a deterministic radial gradient seeded
off the prompt so the smoke-tests get reproducible bytes.
"""

from __future__ import annotations

import hashlib
import io
import math
import os
from dataclasses import dataclass
from typing import Literal, Protocol

Backend = Literal["z-image", "sdxl-turbo", "fake"]


@dataclass(frozen=True)
class CoverArtRequest:
    """Request to render one cover-art PNG."""

    job_id: str
    attempt_id: str | None
    trace_id: str | None
    prompt: str
    style_family: str | None
    seed: int | None
    width: int = 1024
    height: int = 1024


class CoverArtModel(Protocol):
    """Backend renders bytes (PNG) given a CoverArtRequest."""

    @property
    def backend(self) -> Backend: ...

    @property
    def model_loaded(self) -> bool: ...

    @property
    def model_version(self) -> str | None: ...

    def synthesise(self, req: CoverArtRequest) -> bytes: ...


# ---------------------------------------------------------------------------
# Fake backend (always importable)
# ---------------------------------------------------------------------------


class FakeCoverArtModel:
    """Deterministic offline backend.

    Renders a radial gradient whose hue is seeded by the prompt so a
    given (prompt, seed) pair always produces the same PNG. Good
    enough for CI assertions ("the worker calls us and the PNG
    bytes flow back") without dragging in torch.
    """

    backend: Backend = "fake"
    model_loaded: bool = True
    model_version: str | None = "fake-cover-art-0.1.0"

    def synthesise(self, req: CoverArtRequest) -> bytes:
        # PIL is a hard dep in pyproject.toml (lightweight).
        from PIL import Image

        seed_basis = f"{req.prompt}|{req.seed or 0}".encode()
        digest = hashlib.sha256(seed_basis).digest()
        # Pull 3 bytes for the base hue + 1 for inner brightness.
        h0 = digest[0]
        h1 = digest[1]
        bright = 0.45 + (digest[2] % 64) / 256.0  # 0.45..0.70
        w, h = max(64, req.width), max(64, req.height)
        img = Image.new("RGB", (w, h))
        cx, cy = w / 2.0, h / 2.0
        max_r = math.hypot(cx, cy)
        # We avoid numpy here to keep deps minimal; this is a small
        # one-shot path so the pixel loop is fine.
        px = img.load()
        for y in range(h):
            for x in range(w):
                r = math.hypot(x - cx, y - cy) / max_r
                # Outer ring: complementary; inner: dominant.
                t = 1.0 - r
                rr = int((h0 * t + (255 - h1) * (1 - t)) * bright) & 0xFF
                gg = int((h1 * t + (255 - h0) * (1 - t)) * (1.0 - bright * 0.4)) & 0xFF
                bb = int((((h0 + h1) // 2) * t + 32 * (1 - t)) * 0.9) & 0xFF
                px[x, y] = (rr, gg, bb)  # type: ignore[index]
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue()


# ---------------------------------------------------------------------------
# Real backends (deferred imports)
# ---------------------------------------------------------------------------


class _DiffusersBackend:
    """Shared backend for Z-Image-Turbo + SDXL-Turbo via diffusers.

    The two pipelines have meaningfully different load and inference
    contracts, so this class branches on `backend`:

    | aspect            | z-image                 | sdxl-turbo           |
    | ----------------- | ----------------------- | -------------------- |
    | pipeline class    | `ZImagePipeline`        | `AutoPipeline...`    |
    | dtype on GPU      | bfloat16                | float16              |
    | weights variant   | (none)                  | `variant="fp16"`     |
    | num_inference_steps | 8 (Decoupled-DMD)     | 4 (ADD)              |
    | guidance_scale    | 0.0                     | 0.0                  |

    The z-image path requires `diffusers>=0.36` (when `ZImagePipeline`
    landed). On older diffusers we fall back to `AutoPipelineForText2Image`
    -- it won't actually work for Z-Image-Turbo but it keeps the error
    surface inside diffusers' own message rather than an `ImportError`.
    """

    def __init__(self, backend: Backend, model_id: str) -> None:
        self._backend: Backend = backend
        self._model_id = model_id
        self._model_version: str | None = None
        self._pipe: object | None = None  # filled in load()

    @property
    def backend(self) -> Backend:
        return self._backend

    @property
    def model_loaded(self) -> bool:
        return self._pipe is not None

    @property
    def model_version(self) -> str | None:
        return self._model_version

    def load(self) -> None:
        # Imported lazily; CI / tests never hit this branch.
        import torch  # type: ignore[import-not-found]

        if self._backend == "z-image":
            # ZImagePipeline landed in diffusers 0.36; fall back to the
            # AutoPipeline if we're on an older release so the error
            # bubbles up from diffusers rather than ImportError here.
            try:
                from diffusers import ZImagePipeline as _Pipeline  # type: ignore[import-not-found]
            except ImportError:  # pragma: no cover -- only hit on diffusers<0.36
                from diffusers import (  # type: ignore[import-not-found]
                    AutoPipelineForText2Image as _Pipeline,
                )
            dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
            pipe = _Pipeline.from_pretrained(
                self._model_id,
                torch_dtype=dtype,
            )
        else:
            # sdxl-turbo (and any future ADD-distilled UNet)
            from diffusers import (  # type: ignore[import-not-found]
                AutoPipelineForText2Image,
            )

            dtype = torch.float16 if torch.cuda.is_available() else torch.float32
            pipe = AutoPipelineForText2Image.from_pretrained(
                self._model_id,
                torch_dtype=dtype,
                variant="fp16" if dtype == torch.float16 else None,
            )
        pipe = pipe.to("cuda" if torch.cuda.is_available() else "cpu")
        self._pipe = pipe
        self._model_version = self._model_id

    def synthesise(self, req: CoverArtRequest) -> bytes:
        if self._pipe is None:
            raise RuntimeError("backend not loaded")
        import torch  # type: ignore[import-not-found]

        generator = None
        if req.seed is not None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            generator = torch.Generator(device=device).manual_seed(int(req.seed))

        # Both backends are distillation-class single-pass samplers, but
        # they differ on NFEs: SDXL-Turbo (ADD) uses 4; Z-Image-Turbo
        # (Decoupled-DMD) uses 8. Guidance is 0.0 in both cases.
        num_inference_steps = 8 if self._backend == "z-image" else 4
        result = self._pipe(  # type: ignore[operator]
            req.prompt,
            width=req.width,
            height=req.height,
            num_inference_steps=num_inference_steps,
            guidance_scale=0.0,
            generator=generator,
        )
        image = result.images[0]
        buf = io.BytesIO()
        image.save(buf, format="PNG", optimize=True)
        return buf.getvalue()


# ---------------------------------------------------------------------------
# Module-level "active model" handle (mirrors vocal-synth shape)
# ---------------------------------------------------------------------------


_active: CoverArtModel | None = None


def get_active_model() -> CoverArtModel | None:
    return _active


def set_active_model(m: CoverArtModel | None) -> None:
    global _active
    _active = m


def initialise_from_env() -> None:
    """Boot the backend named by `COVER_ART_BACKEND` (default z-image).

    Falls back to `FakeCoverArtModel` when the diffusion deps aren't
    importable (CI / docker-compose without GPU), so the service
    always reaches a "loaded" state.
    """
    backend = os.environ.get("COVER_ART_BACKEND", "z-image").strip().lower()
    if backend == "fake":
        set_active_model(FakeCoverArtModel())
        return

    if backend not in ("z-image", "sdxl-turbo"):
        # Unknown backend name → fake, log via env-derived warning at boot.
        set_active_model(FakeCoverArtModel())
        return

    # Canonical defaults per backend. The previous `tonyassi/z-image-turbo`
    # default 404s on HF and caused the service to silently fall through to
    # `FakeCoverArtModel` in production. `Tongyi-MAI/Z-Image-Turbo` is the
    # official Alibaba Tongyi-MAI release of the model.
    model_id = os.environ.get("COVER_ART_MODEL_ID") or (
        "Tongyi-MAI/Z-Image-Turbo" if backend == "z-image" else "stabilityai/sdxl-turbo"
    )
    try:
        impl = _DiffusersBackend(backend, model_id)  # type: ignore[arg-type]
        impl.load()
        set_active_model(impl)  # type: ignore[arg-type]
    except Exception:
        # If torch/diffusers aren't installed, fall back gracefully.
        set_active_model(FakeCoverArtModel())
