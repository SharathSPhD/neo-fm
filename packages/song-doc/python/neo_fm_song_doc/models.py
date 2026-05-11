"""
Python pydantic v2 mirror of the canonical Zod-defined Song Document.

Phase 0: hand-written to mirror packages/song-doc/src/index.ts. Drift between
the two is caught in CI by parsing every fixture from packages/song-doc/fixtures/
through both code paths and comparing parsed shapes.

Phase 2 replaces this file with codegen from the JSON Schema emitted by
zod-to-json-schema; until then, edit both languages in lockstep.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Language = Literal["en", "hi", "kn"]
StyleFamily = Literal["western", "carnatic", "hindustani", "kannada-folk"]
Duration = Literal[30, 60, 90, 180]
Script = Literal["latin", "devanagari", "tamil", "kannada", "telugu", "bengali"]

SectionType = Literal[
    "intro",
    "verse",
    "chorus",
    "bridge",
    "outro",
    "pallavi",
    "anupallavi",
    "charanam",
    "mukhda",
    "antara",
    "saranam",
    "alaap",
    "sargam",
    "folk_refrain",
    "folk_stanza",
]


class Section(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    type: SectionType
    lyrics: str | None = None
    script: Script | None = None
    transliteration: str | None = None
    swara_sequence: str | None = None
    phonemes: list[str] | None = None
    target_seconds: int = Field(ge=1, le=360)


class RagaSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    system: Literal["carnatic", "hindustani"]
    arohana: list[str] | None = None
    avarohana: list[str] | None = None
    nyas: list[str] | None = None
    pakad: str | None = None


class Orchestration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lead_vocal: Literal["male", "female", "instrumental"] | None = None
    instruments: list[str] | None = None
    texture: str | None = None


class SongDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    user_id: str | None = None
    language: Language
    style_family: StyleFamily
    tempo_bpm: int | None = Field(default=None, ge=30, le=240)
    time_signature: str | None = None
    tala: str | None = None
    target_duration_seconds: Duration
    sections: list[Section] = Field(min_length=1)
    orchestration: Orchestration | None = None
    raga: RagaSpec | None = None
    metadata: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _raga_matches_style(self) -> SongDocument:
        if self.raga is None:
            return self
        raga_system = self.raga.system
        style = self.style_family
        match (raga_system, style):
            case ("carnatic", "carnatic") | ("hindustani", "hindustani"):
                return self
            case _:
                raise ValueError(
                    f'raga.system "{raga_system}" does not match style_family "{style}"'
                )


class NotYetIntegratedError(RuntimeError):
    """Raised when a planned-but-deferred component is reached at runtime."""

    def __init__(self, component: str, phase: int) -> None:
        super().__init__(
            f"{component} integration lands in Phase {phase}; not wired yet."
        )
        self.component = component
        self.phase = phase
