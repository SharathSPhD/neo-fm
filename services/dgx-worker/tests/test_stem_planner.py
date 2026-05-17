"""Tests for the v1.4 Sprint 11 stem planner.

Sprint 11 contract: a bhavageete render with section transitions
must log ≥3 stem inserts. The planner is the only thing that knows
*where* the inserts go, so this test pins that contract.
"""

from __future__ import annotations

import pytest

from app.stem_planner import PlannerSection, plan_stem_inserts


def _bhavageete_sections() -> list[PlannerSection]:
    """Mirror a typical bhavageete: pallavi → anupallavi → charanam
    → anupallavi (return). Four sections, three interior boundaries."""
    return [
        PlannerSection(id="s-pallavi", target_seconds=20),
        PlannerSection(id="s-anupallavi", target_seconds=25),
        PlannerSection(id="s-charanam", target_seconds=40),
        PlannerSection(id="s-return", target_seconds=20),
    ]


def test_bhavageete_planner_produces_three_inserts() -> None:
    plan = plan_stem_inserts(
        sections=_bhavageete_sections(),
        style_family="kannada-light-classical",
    )
    assert len(plan) == 3
    # The three inserts cover the three internal boundaries.
    assert [p.section_index for p in plan] == [0, 1, 2]
    # Boundaries sit at cumulative section times.
    assert [p.insert_at_seconds for p in plan] == [20.0, 45.0, 85.0]


def test_bhavageete_planner_rotates_through_library() -> None:
    """With 3 boundaries and 3 distinct stems in the library, the
    planner should pick all three (no repeats)."""
    plan = plan_stem_inserts(
        sections=_bhavageete_sections(),
        style_family="kannada-light-classical",
    )
    presets = [p.preset for p in plan]
    assert presets == [
        "harmonium_interlude",
        "tabla_tihai",
        "tanpura_drone",
    ]


def test_carnatic_planner_picks_mridangam_first() -> None:
    sections = [
        PlannerSection(id="s-a", target_seconds=30),
        PlannerSection(id="s-b", target_seconds=30),
        PlannerSection(id="s-c", target_seconds=30),
    ]
    plan = plan_stem_inserts(sections=sections, style_family="carnatic")
    assert plan[0].preset == "mridangam_korvai"
    assert plan[1].preset == "tanpura_drone"


def test_tamil_folk_planner_picks_parai_first() -> None:
    sections = [
        PlannerSection(id="s-a", target_seconds=20),
        PlannerSection(id="s-b", target_seconds=20),
    ]
    plan = plan_stem_inserts(sections=sections, style_family="tamil-folk")
    assert len(plan) == 1
    assert plan[0].preset == "parai_break"


def test_western_style_yields_no_inserts() -> None:
    """Western has no preset list; the planner must return [] rather
    than `KeyError` or picking some default."""
    sections = [
        PlannerSection(id="s-a", target_seconds=30),
        PlannerSection(id="s-b", target_seconds=30),
    ]
    plan = plan_stem_inserts(sections=sections, style_family="western")
    assert plan == []


def test_unknown_style_yields_no_inserts() -> None:
    sections = [
        PlannerSection(id="s-a", target_seconds=30),
        PlannerSection(id="s-b", target_seconds=30),
    ]
    plan = plan_stem_inserts(sections=sections, style_family="not-a-real-style")
    assert plan == []


def test_single_section_song_yields_no_inserts() -> None:
    """A one-section song has no internal boundary to decorate."""
    plan = plan_stem_inserts(
        sections=[PlannerSection(id="s-a", target_seconds=60)],
        style_family="kannada-light-classical",
    )
    assert plan == []


def test_max_inserts_caps_planner_output() -> None:
    """A song with 20 sections shouldn't make 19 GPU calls."""
    sections = [
        PlannerSection(id=f"s-{i}", target_seconds=10) for i in range(20)
    ]
    plan = plan_stem_inserts(
        sections=sections,
        style_family="kannada-light-classical",
        max_inserts=4,
    )
    assert len(plan) == 4


def test_zero_max_inserts_returns_empty() -> None:
    plan = plan_stem_inserts(
        sections=_bhavageete_sections(),
        style_family="kannada-light-classical",
        max_inserts=0,
    )
    assert plan == []


@pytest.mark.parametrize(
    "style",
    [
        "carnatic",
        "hindustani",
        "kannada-folk",
        "kannada-light-classical",
        "tamil-folk",
        "bollywood-ballad",
        "sanskrit-shloka",
        "bengali-rabindrasangeet",
        "telugu-keerthana",
    ],
)
def test_indic_styles_have_at_least_one_stem(style: str) -> None:
    """Every Indic style should have at least one transition stem in
    the library so Sprint 11's contract holds for every style."""
    sections = [
        PlannerSection(id="s-a", target_seconds=30),
        PlannerSection(id="s-b", target_seconds=30),
    ]
    plan = plan_stem_inserts(sections=sections, style_family=style)
    assert len(plan) >= 1, f"Style {style} produced an empty plan"
