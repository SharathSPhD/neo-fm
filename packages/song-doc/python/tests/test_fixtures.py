"""Verify every TS fixture parses identically under pydantic."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from neo_fm_song_doc import SongDocument, allocate_section_durations

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.mark.parametrize("path", sorted(FIXTURE_DIR.glob("*.json")), ids=lambda p: p.name)
def test_fixture_parses(path: Path) -> None:
    raw = json.loads(path.read_text(encoding="utf-8"))
    doc = SongDocument.model_validate(raw)
    assert len(doc.sections) >= 1


def test_raga_must_match_style() -> None:
    bad = {
        "language": "kn",
        "style_family": "carnatic",
        "target_duration_seconds": 90,
        "sections": [
            {"id": "s1", "type": "pallavi", "target_seconds": 90, "lyrics": "..."}
        ],
        "raga": {"name": "yaman", "system": "hindustani"},
    }
    with pytest.raises(ValidationError):
        SongDocument.model_validate(bad)


def test_section_seconds_must_sum_to_total() -> None:
    bad = {
        "language": "en",
        "style_family": "western",
        "target_duration_seconds": 90,
        "sections": [
            {"id": "a", "type": "intro", "target_seconds": 20},
            {"id": "b", "type": "verse", "target_seconds": 20},
        ],
    }
    with pytest.raises(ValidationError):
        SongDocument.model_validate(bad)


# ---- v1.4 Sprint 2 widening -------------------------------------------


def test_v14_kannada_light_classical_accepts_carnatic_raga() -> None:
    ok = {
        "language": "kn",
        "style_family": "kannada-light-classical",
        "target_duration_seconds": 30,
        "sections": [
            {"id": "p1", "type": "pallavi", "target_seconds": 30},
        ],
        "raga": {"name": "mohanam", "system": "carnatic"},
    }
    SongDocument.model_validate(ok)


def test_v14_sanskrit_shloka_accepts_new_section_types() -> None:
    ok = {
        "language": "sa",
        "style_family": "sanskrit-shloka",
        "target_duration_seconds": 90,
        "sections": [
            {"id": "v1", "type": "shloka_verse", "target_seconds": 30},
            {"id": "r1", "type": "shloka_refrain", "target_seconds": 30},
            {"id": "ph", "type": "phalashruti", "target_seconds": 30},
        ],
        "raga": {"name": "saveri", "system": "carnatic"},
    }
    SongDocument.model_validate(ok)


def test_v14_western_rejects_any_raga() -> None:
    bad = {
        "language": "en",
        "style_family": "western",
        "target_duration_seconds": 30,
        "sections": [
            {"id": "v", "type": "verse", "target_seconds": 30},
        ],
        "raga": {"name": "yaman", "system": "hindustani"},
    }
    with pytest.raises(ValidationError):
        SongDocument.model_validate(bad)


def test_v14_voice_id_and_background_mix_are_accepted() -> None:
    ok = {
        "language": "kn",
        "style_family": "kannada-light-classical",
        "target_duration_seconds": 30,
        "sections": [
            {"id": "p1", "type": "pallavi", "target_seconds": 30},
        ],
        "voice_id": "kn-female-warm-01",
        "background_mix": {
            "accompaniment_density": "balanced",
            "dynamics": "calm",
            "brightness": "bright",
            "reverb": "hall",
        },
    }
    doc = SongDocument.model_validate(ok)
    assert doc.voice_id == "kn-female-warm-01"
    assert doc.background_mix is not None
    assert doc.background_mix.reverb == "hall"


def test_allocate_fills_unset_seconds() -> None:
    raw: dict[str, object] = {
        "language": "en",
        "style_family": "western",
        "target_duration_seconds": 90,
        "sections": [
            {"id": "a", "type": "intro"},
            {"id": "b", "type": "verse"},
            {"id": "c", "type": "outro"},
        ],
    }
    allocated = allocate_section_durations(raw)
    doc = SongDocument.model_validate(allocated)
    assert sum(s.target_seconds for s in doc.sections) == 90
