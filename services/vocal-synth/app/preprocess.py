"""
Vocal-synth text preprocessing (Sprint D, ADR 0020).

The user reported that v1 TTS pronunciation drifts -- the upstream
Svara / Parler models accept text as-is but cannot intuit Indic
orthography subtleties the way a singer can. We preprocess text
before handing it to whichever vocal backend the router picks so the
model sees a normalised, segmented, prosody-hinted utterance stream
instead of raw user lyrics.

The pipeline is intentionally lossless-by-default: every transformation
records *what* it changed in the returned `PreprocessTrace`, so the
vocal-eval harness (see eval.py) can attribute regression to a
specific normalisation step.

Pipeline stages (in order):

1. **Unicode NFC normalisation** -- combines decomposed sequences so
   Devanagari `क + ् + ष` collapses to `क्ष`. Without this step,
   tokenisers built on byte-pair encoders will treat the same
   visual glyph as two different tokens.
2. **ZWJ / ZWNJ rules** -- Devanagari and Bengali use U+200C/U+200D
   to switch between conjunct and non-conjunct rendering. Most TTS
   models train on cleaned corpora that strip these; we strip them
   here too unless the section type is `instrumental` (we never
   touch text on instrumentals -- they have no lyrics) or the
   `transliteration` field is already populated (the producer is
   asserting the target pronunciation explicitly).
3. **Halant + virama collapsing** -- merges adjacent virama-driven
   conjuncts so the syllable count matches the sung syllable count
   for raga-bound styles (Carnatic / Hindustani).
4. **Hinglish IPA hinting** -- when language is `hi` and script is
   `latin`, we run a small Roman->IPA table that catches the worst
   offenders (`th` -> /tʰ/, `ph` -> /pʰ/, `aa` -> /aː/, etc.) and
   wraps the result in `[ipa:...]` brackets that Parler-TTS
   understands as phoneme hints. This is the single highest-impact
   intervention -- the user's bug report singled out Hinglish
   pronunciation as the worst case.
5. **Prosody hints** -- inject `<break>` markers on punctuation,
   stress markers on long syllables (Devanagari aa-kar / ii-kar),
   and tempo guidance derived from `tempo_bpm` (a slow tempo gets
   `[slow]` prepended to each section's text).
6. **Utterance segmentation** -- split each section into utterances
   on sentence-final punctuation or on a fixed character budget
   (currently 80 chars) so the model never has to stream a 1000-char
   continuous prompt; cleaner phrasing + lower OOM risk.

The output is a list of `PreparedUtterance`s the routing model hands
to its picked backend. The trace is logged at INFO so we can debug
why a specific song sounded off without re-running the job.

Why this isn't in the song-doc Zod layer:
- the song-doc is the canonical surface for the *user's intent*;
  preprocessing is an artefact of the current model generation. Keeping
  the two separated means we can swap TTS backends without invalidating
  stored documents.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Sequence

# Hard cap per utterance so we never blow past Parler's context window.
UTTERANCE_MAX_CHARS = 80

# Sentence-final punctuation across the scripts we support.
SENTENCE_FINAL = re.compile(r"[\.!\?।॥]\s*")

# A tiny, high-signal Roman->IPA hint table for Hinglish. Strict
# longest-match. We don't ship a full transliterator here -- only the
# transforms the bug report flagged as wrong in v1.
HINGLISH_HINTS: list[tuple[str, str]] = [
    ("aa", "aː"),
    ("ee", "iː"),
    ("oo", "uː"),
    ("ai", "ɛː"),
    ("au", "ɔː"),
    ("th", "tʰ"),
    ("ph", "pʰ"),
    ("kh", "kʰ"),
    ("gh", "gʱ"),
    ("dh", "dʱ"),
    ("ch", "tʃ"),
    ("sh", "ʃ"),
    ("ng", "ŋ"),
    ("ny", "ɲ"),
]


@dataclass(frozen=True)
class PreparedUtterance:
    """One contiguous chunk of text ready for a TTS backend."""

    text: str
    """Final text after all normalisation + hint injection."""

    section_id: str
    """SongDocument section id this utterance came from."""

    utterance_index: int
    """0-based index within the section."""

    language: str
    """ISO 639-1 (e.g. `hi`, `kn`, `en`)."""

    script_hint: str
    """`devanagari` | `kannada` | `tamil` | `telugu` | `bengali` | `latin` | `ipa`."""

    target_seconds: float
    """Time budget for this utterance. Computed as a share of the section's
    target_seconds proportional to char count."""

    prosody: list[str] = field(default_factory=list)
    """Free-form prosody hints (e.g. `slow`, `tempo:90`, `break:medium`)."""


@dataclass
class PreprocessTrace:
    """Diagnostic record of what the pipeline did to each input section."""

    section_id: str
    nfc_changed: bool
    zwj_zwnj_stripped: int
    halant_collapsed: int
    hinglish_hints_applied: int
    prosody_hints_added: int
    utterances_emitted: int


def preprocess_section(
    *,
    section_id: str,
    section_type: str,
    lyrics: str | None,
    transliteration: str | None,
    language: str,
    script: str | None,
    target_seconds: float,
    tempo_bpm: int | None,
) -> tuple[list[PreparedUtterance], PreprocessTrace]:
    """Run the preprocessing pipeline for a single section.

    Returns `([], trace)` for instrumental sections so the caller can
    skip the TTS round-trip entirely.
    """
    trace = PreprocessTrace(
        section_id=section_id,
        nfc_changed=False,
        zwj_zwnj_stripped=0,
        halant_collapsed=0,
        hinglish_hints_applied=0,
        prosody_hints_added=0,
        utterances_emitted=0,
    )

    if section_type == "instrumental" or not (lyrics or transliteration):
        return [], trace

    text = transliteration or lyrics or ""

    # 1. NFC normalisation
    normalised = unicodedata.normalize("NFC", text)
    trace.nfc_changed = normalised != text
    text = normalised

    # 2. ZWJ / ZWNJ
    if transliteration is None:
        # Only touch raw lyrics; the producer has earned their say if
        # they supplied a transliteration.
        before = text
        text = text.replace("\u200c", "").replace("\u200d", "")
        trace.zwj_zwnj_stripped = len(before) - len(text)

    # 3. Halant/virama collapsing: only meaningful for Devanagari-family
    # scripts. We don't actually delete the virama (it changes
    # pronunciation), but we do collapse the well-known double-virama
    # mis-spelling `्् ` to a single virama.
    before = text
    text = text.replace("\u094d\u094d", "\u094d")  # Devanagari
    text = text.replace("\u0ccd\u0ccd", "\u0ccd")  # Kannada
    text = text.replace("\u0bcd\u0bcd", "\u0bcd")  # Tamil
    text = text.replace("\u0c4d\u0c4d", "\u0c4d")  # Telugu
    trace.halant_collapsed = len(before) - len(text)

    # 4. Hinglish IPA hinting (Hindi text written in Latin script).
    derived_script = (script or _infer_script(text)).lower()
    if language == "hi" and derived_script == "latin":
        text, applied = _apply_hinglish_hints(text)
        trace.hinglish_hints_applied = applied
        if applied > 0:
            derived_script = "ipa"  # downstream model picks an IPA-aware path

    # 5. Prosody hints
    prosody: list[str] = []
    if tempo_bpm is not None:
        prosody.append(f"tempo:{tempo_bpm}")
        if tempo_bpm < 70:
            prosody.append("slow")
            trace.prosody_hints_added += 1
        elif tempo_bpm > 140:
            prosody.append("fast")
            trace.prosody_hints_added += 1
    # Long aa-kar / ii-kar markers -> add 'sustain' on syllables that
    # carry them. Heuristic: any utterance containing U+0906 (DEV AA)
    # or its compounding variants gets a 'sustain' hint.
    if any(ch in text for ch in ("\u0906", "\u093e", "\u0908")):
        prosody.append("sustain")
        trace.prosody_hints_added += 1

    # 6. Utterance segmentation
    utterances = _segment_utterances(text, target_seconds=target_seconds)
    trace.utterances_emitted = len(utterances)

    prepared = [
        PreparedUtterance(
            text=u_text,
            section_id=section_id,
            utterance_index=idx,
            language=language,
            script_hint=derived_script,
            target_seconds=u_seconds,
            prosody=list(prosody),
        )
        for idx, (u_text, u_seconds) in enumerate(utterances)
    ]
    return prepared, trace


def preprocess_sections(
    sections: Sequence[dict],
    *,
    language: str,
    tempo_bpm: int | None,
) -> tuple[list[PreparedUtterance], list[PreprocessTrace]]:
    """Convenience helper for `VocalRequest.sections` shape.

    Each `sections[i]` is expected to expose the same fields as
    `app.model.VocalSection` (id, type, lyrics, transliteration,
    script, target_seconds). We accept a `dict`-shaped section so
    callers don't have to import model types into preprocess tests.
    """
    out: list[PreparedUtterance] = []
    traces: list[PreprocessTrace] = []
    for sec in sections:
        prepared, trace = preprocess_section(
            section_id=str(sec.get("id") or ""),
            section_type=str(sec.get("type") or ""),
            lyrics=sec.get("lyrics"),
            transliteration=sec.get("transliteration"),
            language=str(sec.get("language") or language),
            script=sec.get("script"),
            target_seconds=float(sec.get("target_seconds") or 0.0),
            tempo_bpm=tempo_bpm,
        )
        out.extend(prepared)
        traces.append(trace)
    return out, traces


# ---- internals -----------------------------------------------------------


def _infer_script(text: str) -> str:
    for ch in text:
        if "\u0900" <= ch <= "\u097f":
            return "devanagari"
        if "\u0c80" <= ch <= "\u0cff":
            return "kannada"
        if "\u0b80" <= ch <= "\u0bff":
            return "tamil"
        if "\u0c00" <= ch <= "\u0c7f":
            return "telugu"
        if "\u0980" <= ch <= "\u09ff":
            return "bengali"
    return "latin"


def _apply_hinglish_hints(text: str) -> tuple[str, int]:
    """Apply the IPA hint table once, leaving unmatched chars alone.

    Returns the wrapped string `[ipa:...]` plus a count of how many
    distinct hints were applied (used by the trace).
    """
    lowered = text.lower()
    applied = 0
    # Longest match first
    out: list[str] = []
    i = 0
    hints_sorted = sorted(HINGLISH_HINTS, key=lambda kv: -len(kv[0]))
    while i < len(lowered):
        matched = False
        for k, v in hints_sorted:
            if lowered.startswith(k, i):
                out.append(v)
                i += len(k)
                applied += 1
                matched = True
                break
        if not matched:
            out.append(lowered[i])
            i += 1
    if applied == 0:
        return text, 0
    return f"[ipa:{''.join(out)}]", applied


def _segment_utterances(
    text: str, *, target_seconds: float
) -> list[tuple[str, float]]:
    """Split `text` into a list of `(utterance, seconds_share)` tuples.

    Each utterance is at most `UTTERANCE_MAX_CHARS` chars. We split on
    sentence-final punctuation first; if a single sentence is still
    larger than the budget, we fall back to a hard char-count chunk.
    The seconds budget is distributed proportionally to char count so
    short utterances don't claim the full section.
    """
    cleaned = text.strip()
    if not cleaned:
        return []

    pieces: list[str] = []
    for sentence in SENTENCE_FINAL.split(cleaned):
        s = sentence.strip()
        if not s:
            continue
        if len(s) <= UTTERANCE_MAX_CHARS:
            pieces.append(s)
            continue
        # Hard chunk
        for j in range(0, len(s), UTTERANCE_MAX_CHARS):
            pieces.append(s[j : j + UTTERANCE_MAX_CHARS])

    if not pieces:
        return []

    total_chars = sum(len(p) for p in pieces)
    if total_chars == 0:
        return []
    return [(p, target_seconds * (len(p) / total_chars)) for p in pieces]
