"""
v1.4 Sprint 5: voice catalogue loader.

Reads `services/vocal-synth/app/voice_catalog.json` once at import time
and exposes:

  * :data:`VOICES` -- frozen mapping `voice_id -> VoiceEntry`
  * :func:`get_voice` -- look up by id, returns `None` on miss
  * :func:`voices_for_language` -- filter helper for the web UI

The catalogue is *append-only*. SongDocuments that reference an older
voice_id must keep resolving even when we add new entries -- the test
suite enforces this via a snapshot of the v1.4 ids.

The vocal-synth router uses the entry's `backend` field to override
:func:`app.routing._pick_backend`'s language-based decision: when a
section carries a `voice_id`, the catalogue entry's backend wins
(currently every entry is ``parler`` because IndicF5 lands in Sprint 12).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

VoiceBackend = Literal["parler", "svara", "indicf5", "nemo"]

_CATALOG_PATH = Path(__file__).resolve().parent / "voice_catalog.json"


@dataclass(frozen=True)
class VoiceEntry:
    """One row of the catalogue."""

    voice_id: str
    language: str
    gender: Literal["male", "female", "androgynous"]
    persona: str
    label: str
    backend: VoiceBackend
    prompt: str
    preview_path: str


def _load_raw() -> dict[str, VoiceEntry]:
    with _CATALOG_PATH.open(encoding="utf-8") as f:
        payload = json.load(f)
    voices: dict[str, VoiceEntry] = {}
    for row in payload["voices"]:
        entry = VoiceEntry(
            voice_id=row["voice_id"],
            language=row["language"],
            gender=row["gender"],
            persona=row["persona"],
            label=row["label"],
            backend=row["backend"],
            prompt=row["prompt"],
            preview_path=row["preview_path"],
        )
        if entry.voice_id in voices:
            raise ValueError(
                f"voice_catalog.json: duplicate voice_id {entry.voice_id!r}",
            )
        voices[entry.voice_id] = entry
    return voices


@lru_cache(maxsize=1)
def _voices_cached() -> dict[str, VoiceEntry]:
    return _load_raw()


# `VOICES` is the public read-only handle. `dict.copy()` keeps the
# external accessor from accidentally mutating the cached map.
VOICES: dict[str, VoiceEntry] = _voices_cached()


def get_voice(voice_id: str | None) -> VoiceEntry | None:
    """Return the catalogue entry for ``voice_id`` or ``None``."""
    if not voice_id:
        return None
    return _voices_cached().get(voice_id)


def voices_for_language(language: str) -> list[VoiceEntry]:
    """Return the catalogue entries whose ``language`` matches."""
    return [v for v in _voices_cached().values() if v.language == language]


def all_voice_ids() -> list[str]:
    """Stable, lexicographic list of every catalogue voice_id."""
    return sorted(_voices_cached().keys())
