"""Verify every TS fixture parses identically under pydantic."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from neo_fm_song_doc import SongDocument

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
            {"id": "s1", "type": "pallavi", "target_seconds": 30, "lyrics": "..."}
        ],
        "raga": {"name": "yaman", "system": "hindustani"},
    }
    with pytest.raises(Exception):
        SongDocument.model_validate(bad)
