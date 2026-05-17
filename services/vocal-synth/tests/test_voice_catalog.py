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
    # Use a Sanskrit chant voice which is on Parler post-S13.
    key, reason = _pick_backend(_section_with_voice("chant_sustained"))
    assert key == "parler"
    assert reason == "voice_id:chant_sustained"


def test_sprint_12_indicf5_personas_are_pinned() -> None:
    """v1.4 Sprint 12 contract: 8 indic_* personas point at IndicF5."""
    indicf5_voices = [v for v in VOICES.values() if v.backend == "indicf5"]
    assert {v.voice_id for v in indicf5_voices} == {
        "indic_hi_male_broadcast",
        "indic_hi_female_lyrical",
        "indic_ta_male_nadaswaram",
        "indic_ta_female_devotional",
        "indic_te_male",
        "indic_te_female",
        "indic_bn_male_rabindra",
        "indic_bn_female",
    }


def test_sprint_13_nemo_personas_are_pinned() -> None:
    """v1.4 Sprint 13 contract: 2 indic_kn_* personas flip from
    Parler to custom NeMo Kannada. No other entry changes backend."""
    nemo_voices = [v for v in VOICES.values() if v.backend == "nemo"]
    assert {v.voice_id for v in nemo_voices} == {
        "indic_kn_male_warm",
        "indic_kn_female_bhajan",
    }


def test_pick_backend_indicf5_voice_routes_to_indicf5() -> None:
    """Spot-check: indic_hi_male_broadcast now routes to indicf5."""
    key, reason = _pick_backend(_section_with_voice("indic_hi_male_broadcast"))
    assert key == "indicf5"
    assert reason == "voice_id:indic_hi_male_broadcast"


def test_pick_backend_with_unknown_voice_id_falls_through() -> None:
    # Unknown ids fall through to the language-based decision.
    key, reason = _pick_backend(_section_with_voice("ghost-persona"))
    assert key == "parler"
    assert reason == "english-text"


def test_pick_backend_with_none_voice_id_uses_legacy_routing() -> None:
    key, reason = _pick_backend(_section_with_voice(None))
    assert key == "parler"
    assert reason == "english-text"
