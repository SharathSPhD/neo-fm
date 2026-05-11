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

    id: str = Field(min_length=1, max_length=64)
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
                pass
            case _:
                raise ValueError(
                    f'raga.system "{raga_system}" does not match style_family "{style}"'
                )
        return self

    @model_validator(mode="after")
    def _section_seconds_sum_matches_total(self) -> SongDocument:
        total = sum(s.target_seconds for s in self.sections)
        if total != self.target_duration_seconds:
            raise ValueError(
                f"sum(section.target_seconds) = {total} must equal "
                f"target_duration_seconds = {self.target_duration_seconds}; "
                "use allocate_section_durations() to auto-fill before validation"
            )
        return self


def allocate_section_durations(payload: dict[str, Any]) -> dict[str, Any]:
    """Mirror of `allocateSectionDurations()` in the TS source.

    Fills any `target_seconds` left unset across `payload['sections']` by
    splitting `payload['target_duration_seconds']` equally over the unset
    slots. Returns a new dict — the input is not mutated. The result is
    *not yet validated*; pipe it through `SongDocument.model_validate()`.
    """
    sections_in: list[dict[str, Any]] = list(payload.get("sections", []))
    total = int(payload["target_duration_seconds"])
    fixed_sum = sum(int(s["target_seconds"]) for s in sections_in if "target_seconds" in s)
    unset = [s for s in sections_in if "target_seconds" not in s]
    remaining = total - fixed_sum
    if remaining < 0:
        raise ValueError(
            f"fixed sections already consume {fixed_sum}s, exceeds "
            f"target_duration_seconds = {total}"
        )
    if not unset and remaining != 0:
        raise ValueError(
            f"all section.target_seconds set but sum = {fixed_sum} != "
            f"target_duration_seconds = {total}"
        )
    sections_out: list[dict[str, Any]] = []
    if unset:
        per, extra = divmod(remaining, len(unset))
        i = 0
        for s in sections_in:
            if "target_seconds" in s:
                sections_out.append(dict(s))
            else:
                share = per + (1 if i < extra else 0)
                sections_out.append({**s, "target_seconds": share})
                i += 1
    else:
        sections_out = [dict(s) for s in sections_in]
    return {**payload, "sections": sections_out}


class NotYetIntegratedError(RuntimeError):
    """Raised when a planned-but-deferred component is reached at runtime."""

    def __init__(self, component: str, phase: int) -> None:
        super().__init__(
            f"{component} integration lands in Phase {phase}; not wired yet."
        )
        self.component = component
        self.phase = phase
