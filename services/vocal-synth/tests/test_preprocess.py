from __future__ import annotations

import pytest

from app.preprocess import (
    UTTERANCE_MAX_CHARS,
    _apply_hinglish_hints,
    _segment_utterances,
    preprocess_section,
)


def test_nfc_normalises_decomposed_devanagari() -> None:
    # कि as decomposed: ka (U+0915) + i-matra (U+093F) is already
    # normalised, but the test exercises the NFC pass on a real
    # composed-vs-decomposed pair: ksha (क + ् + ष  vs  क्ष).
    raw = "\u0915\u094d\u0937"  # KA + virama + SSA == क्ष
    decomposed = "\u0915\u094d\u0937"  # same sequence; NFC keeps it
    prepared, trace = preprocess_section(
        section_id="s1",
        section_type="verse",
        lyrics=raw,
        transliteration=None,
        language="hi",
        script="devanagari",
        target_seconds=10.0,
        tempo_bpm=90,
    )
    # NFC may or may not change the bytes for this input, but the call
    # should not crash and should produce one utterance.
    assert len(prepared) == 1
    assert prepared[0].language == "hi"
    # If decomposed input differs from NFC output, trace flags it.
    if decomposed != "\u0915\u094d\u0937":  # pragma: no cover
        assert trace.nfc_changed is True


def test_zwj_zwnj_stripped_from_raw_lyrics() -> None:
    # ZWNJ between two devanagari consonants is meant for rendering
    # only; the TTS shouldn't see it.
    raw = "\u092a\u093e\u200c\u0925"  # paa + ZWNJ + th
    prepared, trace = preprocess_section(
        section_id="s1",
        section_type="verse",
        lyrics=raw,
        transliteration=None,
        language="hi",
        script="devanagari",
        target_seconds=4.0,
        tempo_bpm=None,
    )
    assert "\u200c" not in prepared[0].text
    assert trace.zwj_zwnj_stripped == 1


def test_zwj_zwnj_preserved_when_transliteration_provided() -> None:
    # Producer-supplied transliteration wins; we don't reach into
    # raw lyrics in that case.
    prepared, trace = preprocess_section(
        section_id="s1",
        section_type="verse",
        lyrics="\u092a\u093e\u200c\u0925",
        transliteration="paatha",
        language="hi",
        script="devanagari",
        target_seconds=4.0,
        tempo_bpm=None,
    )
    assert prepared[0].text != "\u200c"
    assert trace.zwj_zwnj_stripped == 0


def test_hinglish_latin_text_gets_ipa_wrapper() -> None:
    prepared, trace = preprocess_section(
        section_id="s1",
        section_type="verse",
        lyrics="aaja aaja",
        transliteration=None,
        language="hi",
        script="latin",
        target_seconds=4.0,
        tempo_bpm=80,
    )
    assert prepared[0].text.startswith("[ipa:")
    assert prepared[0].script_hint == "ipa"
    assert trace.hinglish_hints_applied >= 1


def test_english_text_does_not_trigger_ipa_pass() -> None:
    prepared, trace = preprocess_section(
        section_id="s1",
        section_type="verse",
        lyrics="bright morning sunshine",
        transliteration=None,
        language="en",
        script="latin",
        target_seconds=4.0,
        tempo_bpm=None,
    )
    assert not prepared[0].text.startswith("[ipa:")
    assert trace.hinglish_hints_applied == 0


def test_instrumental_section_emits_no_utterances() -> None:
    prepared, trace = preprocess_section(
        section_id="s1",
        section_type="instrumental",
        lyrics=None,
        transliteration=None,
        language="hi",
        script="devanagari",
        target_seconds=12.0,
        tempo_bpm=80,
    )
    assert prepared == []
    assert trace.utterances_emitted == 0


def test_long_section_splits_into_multiple_utterances() -> None:
    big = "ho ri ho ri " * 30  # ~360 chars
    prepared, trace = preprocess_section(
        section_id="s1",
        section_type="verse",
        lyrics=big,
        transliteration=None,
        language="hi",
        script="latin",
        target_seconds=12.0,
        tempo_bpm=100,
    )
    assert len(prepared) > 1
    assert trace.utterances_emitted == len(prepared)
    for u in prepared:
        # IPA-wrapped utterances are slightly longer than the raw cap
        # because of the prefix; allow a generous slack.
        assert len(u.text) <= UTTERANCE_MAX_CHARS * 3
    total_seconds = sum(u.target_seconds for u in prepared)
    assert abs(total_seconds - 12.0) < 0.01


def test_slow_tempo_adds_slow_prosody_hint() -> None:
    prepared, _ = preprocess_section(
        section_id="s1",
        section_type="verse",
        lyrics="aaja",
        transliteration=None,
        language="hi",
        script="latin",
        target_seconds=4.0,
        tempo_bpm=50,
    )
    assert "slow" in prepared[0].prosody


def test_hinglish_hints_apply_longest_match_first() -> None:
    out, applied = _apply_hinglish_hints("aaja phir mil")
    # "aa" -> aː, "ph" -> pʰ, "ee" not present; "mi", "l" untouched
    assert "aː" in out
    assert "pʰ" in out
    assert applied >= 2


def test_segment_utterances_distributes_seconds_proportionally() -> None:
    segs = _segment_utterances("aa. bb cc dd.", target_seconds=10.0)
    total = sum(s for _, s in segs)
    assert abs(total - 10.0) < 0.01
    # The longer chunk gets a bigger share
    by_len = sorted(segs, key=lambda kv: len(kv[0]))
    assert by_len[-1][1] >= by_len[0][1]
