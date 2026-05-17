"""
GENERATED FILE — DO NOT EDIT BY HAND.

Run `python3 scripts/song-doc-codegen.py` from the repo root after editing
`packages/song-doc/src/index.ts`. CI verifies this file matches the codegen
output via `python3 scripts/song-doc-codegen.py --check`.

Source of truth: packages/song-doc/song-doc.schema.json (exported from Zod).
Cross-field validators live in `models.py`, not here, because JSON Schema
cannot represent them.
"""

# ruff: noqa: E501, I001
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field

class Section(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    type: Literal['intro', 'verse', 'chorus', 'bridge', 'outro', 'pallavi', 'anupallavi', 'charanam', 'mukhda', 'antara', 'saranam', 'alaap', 'sargam', 'folk_refrain', 'folk_stanza', 'shloka_verse', 'shloka_refrain', 'phalashruti']
    lyrics: str | None = Field(default=None, max_length=1000)
    script: Literal['latin', 'devanagari', 'tamil', 'kannada', 'telugu', 'bengali'] | None = None
    transliteration: str | None = None
    swara_sequence: str | None = None
    phonemes: list[str] | None = None
    target_seconds: int = Field(ge=1, le=360)
    tags: list[str] | None = None
    voice_id: str | None = Field(default=None, min_length=1, max_length=64)
    language: str | None = Field(default=None, min_length=2, max_length=16)


class Orchestration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lead_vocal: Literal['male', 'female', 'instrumental'] | None = None
    instruments: list[str] | None = None
    texture: str | None = None


class Raga(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    system: Literal['carnatic', 'hindustani', 'light-classical', 'folk']
    arohana: list[str] | None = None
    avarohana: list[str] | None = None
    nyas: list[str] | None = None
    pakad: str | None = None


class BackgroundMix(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accompaniment_density: Literal['sparse', 'balanced', 'dense'] | None = None
    dynamics: Literal['calm', 'balanced', 'energetic'] | None = None
    brightness: Literal['dark', 'neutral', 'bright'] | None = None
    reverb: Literal['dry', 'room', 'hall', 'cathedral'] | None = None


class _SongDocumentBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = Field(default=None, pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    user_id: str | None = Field(default=None, pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    title: str | None = Field(default=None, min_length=1, max_length=120)
    language: Literal['en', 'hi', 'kn', 'ta', 'bn', 'te', 'sa']
    style_family: Literal['western', 'carnatic', 'hindustani', 'kannada-folk', 'kannada-light-classical', 'tamil-folk', 'bollywood-ballad', 'sanskrit-shloka', 'bengali-rabindrasangeet', 'telugu-keerthana']
    tempo_bpm: int | None = Field(default=None, ge=30, le=240)
    time_signature: str | None = None
    tala: str | None = None
    target_duration_seconds: Literal[30, 60, 90, 180]
    sections: list[Section] = Field(min_length=1)
    orchestration: Orchestration | None = None
    raga: Raga | None = None
    voice_id: str | None = Field(default=None, min_length=1, max_length=64)
    background_mix: BackgroundMix | None = None
    metadata: dict[str, Any] | None = None
