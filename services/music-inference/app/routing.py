"""Engine routing for music-inference — v1.4 Sprint 10.

`RoutingMusicModel` picks between `HeartMuLaModel` and `MusicGenModel`
based on `style_family`. The route table is:

  - bhavageete (kannada-light-classical), tamil-folk → HeartMuLa+LoRA
  - carnatic, hindustani                              → MusicGen+LoRA
  - western, bollywood-ballad, sanskrit-shloka,       → HeartMuLa (base
    bengali-rabindrasangeet, telugu-keerthana, kannada-folk            or whatever LoRA
                                                       lives there)

The default route in v1.4 keeps HeartMuLa as the fallback so any style
not explicitly routed to MusicGen still gets a model. Sprint 16's
eval suite tunes the table; the default here matches the plan §10.

Operators can override per-style via env::

    MUSIC_ENGINE_CARNATIC=heartmula        # force carnatic onto HeartMuLa
    MUSIC_ENGINE_KANNADA_LIGHT_CLASSICAL=musicgen   # vice versa

When the chosen backend isn't loaded (e.g. MusicGen disabled in dev),
the router falls back to the other and logs a `route_fallback` line so
operators can see what happened. The routing layer never silently
returns silence — if neither backend is available, it raises.
"""

from __future__ import annotations

import logging
import os
from typing import Literal

from app.model import GenerationRequest, MusicModel

LOG = logging.getLogger("music-inference.routing")

Engine = Literal["heartmula", "musicgen"]


# v1.4 Sprint 10 default route table. Sprint 16 may shift entries
# based on MOS results, but the keys are exhaustive over the v1.4
# style_family enum so any future style addition fails the runtime
# `_DEFAULT_ROUTE_TABLE[style]` lookup loudly.
_DEFAULT_ROUTE_TABLE: dict[str, Engine] = {
    "western": "heartmula",
    "carnatic": "musicgen",
    "hindustani": "musicgen",
    "kannada-folk": "heartmula",
    "kannada-light-classical": "heartmula",
    "tamil-folk": "heartmula",
    "bollywood-ballad": "heartmula",
    "sanskrit-shloka": "heartmula",
    "bengali-rabindrasangeet": "heartmula",
    "telugu-keerthana": "heartmula",
}


_ROUTE_ENV: dict[str, str] = {
    "western": "MUSIC_ENGINE_WESTERN",
    "carnatic": "MUSIC_ENGINE_CARNATIC",
    "hindustani": "MUSIC_ENGINE_HINDUSTANI",
    "kannada-folk": "MUSIC_ENGINE_KANNADA_FOLK",
    "kannada-light-classical": "MUSIC_ENGINE_KANNADA_LIGHT_CLASSICAL",
    "tamil-folk": "MUSIC_ENGINE_TAMIL_FOLK",
    "bollywood-ballad": "MUSIC_ENGINE_BOLLYWOOD_BALLAD",
    "sanskrit-shloka": "MUSIC_ENGINE_SANSKRIT_SHLOKA",
    "bengali-rabindrasangeet": "MUSIC_ENGINE_BENGALI_RABINDRASANGEET",
    "telugu-keerthana": "MUSIC_ENGINE_TELUGU_KEERTHANA",
}


def resolve_engine(
    style_family: str,
    *,
    table: dict[str, Engine] | None = None,
    env: dict[str, str] | None = None,
) -> Engine:
    """Pick `heartmula` or `musicgen` for a given style family.

    Resolution order:
      1. Per-style env override (`MUSIC_ENGINE_<STYLE>`)
      2. Per-style default in `table` (defaults to `_DEFAULT_ROUTE_TABLE`)
      3. Hard fallback to `heartmula`

    Unknown styles default to heartmula with a warning — we don't want
    a typo'd SongDocument to 500; HeartMuLa's base model still
    handles any text input.
    """
    table = table if table is not None else _DEFAULT_ROUTE_TABLE
    env = env if env is not None else dict(os.environ)
    env_key = _ROUTE_ENV.get(style_family)
    if env_key is not None:
        override = env.get(env_key, "").strip().lower()
        if override in ("heartmula", "musicgen"):
            return override  # type: ignore[return-value]
    return table.get(style_family, "heartmula")


class RoutingMusicModel:
    """A `MusicModel` that delegates to one of two backends per request.

    `model_loaded` is `True` iff at least one backend is loaded;
    `model_version` reports the active table head. Tests can swap in
    fake backends to verify the routing decision without GPUs.
    """

    def __init__(
        self,
        *,
        heartmula: MusicModel | None,
        musicgen: MusicModel | None,
        route_table: dict[str, Engine] | None = None,
    ) -> None:
        self._heartmula = heartmula
        self._musicgen = musicgen
        self._table = route_table

    @property
    def model_loaded(self) -> bool:
        return any(
            (m is not None and m.model_loaded)
            for m in (self._heartmula, self._musicgen)
        )

    @property
    def model_version(self) -> str | None:
        parts: list[str] = []
        if self._heartmula and self._heartmula.model_version:
            parts.append(f"heartmula={self._heartmula.model_version}")
        if self._musicgen and self._musicgen.model_version:
            parts.append(f"musicgen={self._musicgen.model_version}")
        return ",".join(parts) if parts else None

    def _backend_for(self, engine: Engine) -> MusicModel | None:
        return self._heartmula if engine == "heartmula" else self._musicgen

    def generate(self, req: GenerationRequest) -> bytes:
        chosen: Engine = resolve_engine(req.style_family, table=self._table)
        backend = self._backend_for(chosen)
        if backend is None or not backend.model_loaded:
            # Fall back to the other engine if available.
            other: Engine = "musicgen" if chosen == "heartmula" else "heartmula"
            fb = self._backend_for(other)
            if fb is None or not fb.model_loaded:
                raise RuntimeError(
                    f"RoutingMusicModel: neither {chosen} nor {other} "
                    f"backend is loaded; cannot serve "
                    f"style_family={req.style_family!r}"
                )
            LOG.warning(
                "route_fallback",
                extra={
                    "extra_fields": {
                        "style_family": req.style_family,
                        "chosen": chosen,
                        "actual": other,
                        "reason": "primary_backend_unloaded",
                    }
                },
            )
            backend = fb
        return backend.generate(req)


__all__ = ["Engine", "RoutingMusicModel", "resolve_engine"]
