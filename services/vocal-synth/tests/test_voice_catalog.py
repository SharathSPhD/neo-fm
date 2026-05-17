"""v1.4 Sprint 5: voice catalogue loader and routing integration."""

from __future__ import annotations

from app.model import VocalSection
from app.routing import _pick_backend
from app.voice_catalog import (
    VOICES,
    all_voice_ids,
    get_voice,
    voices_for_language,
)


def _section_with_voice(voice_id: str | None) -> VocalSection:
    return VocalSection(
        id="s1",
        type="verse",
        lyrics="hello world",
        language="en",
        script="latin",
        transliteration=None,
        target_seconds=4,
        tempo_bpm=90,
        raga_name=None,
        voice_timbre="androgynous",
        voice_id=voice_id,
    )


def test_catalog_has_sixteen_voices() -> None:
    assert len(VOICES) == 16


def test_voice_ids_are_unique() -> None:
    ids = list(VOICES.keys())
    assert len(ids) == len(set(ids))


def test_all_voice_ids_returns_sorted() -> None:
    ids = all_voice_ids()
    assert ids == sorted(ids)


def test_get_voice_round_trips_every_entry() -> None:
    for vid, entry in VOICES.items():
        assert get_voice(vid) is entry
    assert get_voice("not-a-real-voice") is None
    assert get_voice(None) is None
    assert get_voice("") is None


def test_voices_for_language_filters() -> None:
    kn = voices_for_language("kn")
    assert [v.voice_id for v in kn] == [
        "indic_kn_male_warm",
        "indic_kn_female_bhajan",
    ]
    assert len(voices_for_language("ta")) == 2
    assert len(voices_for_language("sa")) == 1


def test_pick_backend_with_known_voice_id_uses_catalog_backend() -> None:
    key, reason = _pick_backend(_section_with_voice("indic_kn_female_bhajan"))
    assert key == "parler"
    assert reason == "voice_id:indic_kn_female_bhajan"


def test_pick_backend_with_unknown_voice_id_falls_through() -> None:
    # Unknown ids fall through to the language-based decision.
    key, reason = _pick_backend(_section_with_voice("ghost-persona"))
    assert key == "parler"
    assert reason == "english-text"


def test_pick_backend_with_none_voice_id_uses_legacy_routing() -> None:
    key, reason = _pick_backend(_section_with_voice(None))
    assert key == "parler"
    assert reason == "english-text"
