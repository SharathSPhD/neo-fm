"""Pydantic models for queue messages and the worker's view of song documents.

These mirror docs/contracts/queue-message.schema.json and the SongDocument
shape in packages/song-doc. Validation is strict: an unknown shape becomes
a non-retryable `song_document_invalid` failure (ADR 0008).
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Priority = Literal["normal", "high"]
StyleFamily = Literal[
    "western",
    "carnatic",
    "hindustani",
    "kannada-folk",
    # v1.3 Sprint 2: bhavageete + Tamil folk now have their own
    # families so they stop being mis-routed through kannada-folk.
    "kannada-light-classical",
    "tamil-folk",
    # v1.4 Sprint 2: schema widening. Until the dedicated worker
    # paths land (Sprint 8/14/15) the worker treats these as data
    # forwarded to vocal-synth + music-inference unchanged.
    "bollywood-ballad",
    "sanskrit-shloka",
    "bengali-rabindrasangeet",
    "telugu-keerthana",
]
TargetDuration = Literal[30, 60, 90, 180]
Tier = Literal["free", "creator", "pro"]


class QueueMessage(BaseModel):
    """Body of a `song_generation_jobs` pgmq message."""

    model_config = ConfigDict(extra="forbid")

    job_id: UUID
    user_id: UUID
    song_document_id: UUID
    priority: Priority = "normal"
    created_at: str
    style_family: StyleFamily
    target_duration_seconds: TargetDuration
    tier: Tier | None = None
    attempt_id: UUID
    attempt_number: int = Field(default=1, ge=1)
    trace_id: str = Field(min_length=1)


class SongDocumentSection(BaseModel):
    """Worker-side view; tolerant of optional fields the producer may omit."""

    model_config = ConfigDict(extra="allow")

    id: str
    type: str
    target_seconds: int
    lyrics: str | None = None
    script: str | None = None
    transliteration: str | None = None
    swara_sequence: str | None = None
    phonemes: list[str] | None = None
    tags: list[str] | None = None
    # v1.4 Sprint 5: per-section override of the document-level
    # voice_id. The worker forwards both fields and lets the
    # vocal-synth router decide.
    voice_id: str | None = None


class SongDocument(BaseModel):
    """Subset of the Song Document the worker needs to forward to music-inference."""

    model_config = ConfigDict(extra="allow")

    id: UUID | None = None
    user_id: UUID | None = None
    language: str
    style_family: StyleFamily
    target_duration_seconds: TargetDuration
    sections: list[SongDocumentSection]
    tempo_bpm: int | None = None
    time_signature: str | None = None
    tala: str | None = None
    orchestration: dict[str, object] | None = None
    raga: dict[str, object] | None = None
    metadata: dict[str, object] | None = None
    # v1.4 Sprint 5: opaque voice-catalogue id. Picked by the user in
    # the creation canvas; forwarded by the worker to vocal-synth.
    voice_id: str | None = None
    # v1.4 Sprint 2: background-mix knobs (density/dynamics/...).
    # Worker doesn't act on them yet -- they ride along for mixer
    # consumption in Sprint 11.
    background_mix: dict[str, object] | None = None
