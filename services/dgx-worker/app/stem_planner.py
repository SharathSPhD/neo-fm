"""Plan stem inserts for a song document (v1.4 Sprint 11).

Given the SongDocument's sections + style_family, choose which
stems-synth presets to fetch and where to insert them in the final
mix.

Design choices:

  - **Section boundaries only.** A stem can only land *between* two
    sections, never in the middle of one. The boundary time is the
    cumulative `target_seconds` of all earlier sections.
  - **Style-aware preset library.** Each style_family has a small
    ordered list of stems it prefers (`_STYLE_STEM_LIBRARY`). At
    each boundary we pick the next stem in the list (modulo length),
    so a long song with many sections rotates through the library
    instead of repeating the same stem.
  - **Deterministic.** Same SongDocument + style → same plan. This
    keeps Sprint 16's eval comparable across re-runs.
  - **Cap on count.** `max_inserts_per_song` (default 4 — Sprint 11
    contract says ≥3 for bhavageete) prevents a 120-section song
    from making 120 expensive GPU calls.

The planner is pure-data; the worker handles the HTTP calls + mixer
hand-off. Tests in `test_stem_planner.py` cover the style table.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

# Default per-style preset ordering. Keys must align with the
# style_family Literal in `app.models.StyleFamily`. Tests pin the
# bhavageete entry to ≥3 distinct presets so Sprint 11's contract
# (3 inserts logged) holds with the default `max_inserts_per_song`.
_STYLE_STEM_LIBRARY: dict[str, list[str]] = {
    "western": [],
    "carnatic": [
        "mridangam_korvai",
        "tanpura_drone",
    ],
    "hindustani": [
        "tabla_tihai",
        "tanpura_drone",
    ],
    "kannada-folk": [
        "harmonium_interlude",
        "tanpura_drone",
    ],
    "kannada-light-classical": [
        "harmonium_interlude",
        "tabla_tihai",
        "tanpura_drone",
    ],
    "tamil-folk": [
        "parai_break",
        "nadaswaram_flourish",
    ],
    "bollywood-ballad": [
        "tabla_tihai",
        "harmonium_interlude",
    ],
    "sanskrit-shloka": [
        "shloka_bell_open",
        "tanpura_drone",
    ],
    "bengali-rabindrasangeet": [
        "esraj_swell",
        "tabla_tihai",
    ],
    "telugu-keerthana": [
        "mridangam_korvai",
        "tanpura_drone",
    ],
}


@dataclass(frozen=True)
class PlannedStem:
    """One stems-synth call the worker should make."""
    section_index: int  # 0-based: stem lives *after* section `section_index`
    preset: str
    insert_at_seconds: float
    crossfade_seconds: float = 0.5
    label: str = ""


@dataclass(frozen=True)
class PlannerSection:
    """Pure-data view of a SongDocument section. The worker constructs
    these from the SongDocument's sections list.
    """
    id: str
    target_seconds: float


def plan_stem_inserts(
    *,
    sections: Iterable[PlannerSection],
    style_family: str,
    max_inserts: int = 4,
) -> list[PlannedStem]:
    """Return the stems the worker should fetch + their insert times.

    Empty list when:
      - style_family has no stems in the library (e.g. `western`)
      - song has fewer than 2 sections (no internal boundaries to
        decorate)
      - `max_inserts == 0`
    """
    library = _STYLE_STEM_LIBRARY.get(style_family, [])
    if not library or max_inserts <= 0:
        return []
    section_list = list(sections)
    if len(section_list) < 2:
        return []

    plan: list[PlannedStem] = []
    # Boundaries: index `i` boundary sits after section i (i = 0..N-2).
    cumulative = 0.0
    for i in range(len(section_list) - 1):
        cumulative += float(section_list[i].target_seconds)
        if len(plan) >= max_inserts:
            break
        preset = library[i % len(library)]
        plan.append(
            PlannedStem(
                section_index=i,
                preset=preset,
                insert_at_seconds=cumulative,
                label=f"{style_family}:{preset}@{i}",
            )
        )
    return plan


__all__ = [
    "PlannedStem",
    "PlannerSection",
    "plan_stem_inserts",
]
