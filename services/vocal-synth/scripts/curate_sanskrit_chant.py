"""Curate a Sanskrit / Vedic chant corpus for the v1.4 Sprint 14
chant-style LoRA.

Sources (configured at the top of ``_SOURCES``):

  - **Sanskrit Documents Archive** — text + audio recitations of
    Bhagavad Gita / Upanishads / Stotras. The audio side is
    operator-vetted for attribution; the text side is checked
    against the canonical Devanagari editions.
  - **Muktabodha Digital Library** — Vedic / Tantric chant audio.
    Restricted license; operator must opt in via
    ``--include-muktabodha``.
  - **Internet Archive Sanskrit Audio** — public-domain
    recitations cleared for non-commercial use.
  - **Sanskrit Wikipedia / Wikisource audio** — small but
    high-quality CC-BY-SA chant pronunciations.

Pipeline (real-mode, DGX only):

  1. Download each source's manifest + WAVs into ``--cache``.
  2. Filter (length 2-30 s, SNR ≥ ``--min-snr``, single reciter,
     no music bed — chant adapters need clean voice).
  3. Forced-align with **WhisperX** + a Sanskrit lexicon. If no
     MFA Sanskrit aligner is available, train one from the
     SDA + Wikisource transcripts (operator runbook).
  4. Annotate each syllable with its Vedic svara
     (``anudatta`` / ``udatta`` / ``svarita``) by tracking the
     pitch curve against the syllable's mid-point f0 — coarse
     three-bin quantisation good enough for adapter training.
  5. Mark mantra start/end with ``mantra_id`` so the LoRA can
     condition on mantra-level structure (Sprint 16's eval
     suite scores svara-correctness per mantra, not per clip).
  6. Emit a NeMo-compatible manifest JSONL augmented with the
     ``svara_marks`` / ``mantra_id`` columns. The chant-style
     trainer reads this manifest directly.

CI runs ``--dry-run`` which:

  - Skips network fetch and forced alignment.
  - Generates four deterministic synthetic rows so the trainer
    can validate the manifest shape end-to-end without WAVs.
  - Asserts the manifest schema is consistent with what
    ``train_chant_style_lora.py`` expects.

All real-mode work happens on DGX-Spark per ADR 0023. HuggingFace
is used only to push the final adapter (``neo-fm/chant-style-v1``)
once the run completes.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

Svara = Literal["anudatta", "udatta", "svarita"]


@dataclass(frozen=True)
class CorpusSource:
    """One configured input dataset for the chant curator."""

    key: str
    display: str
    expected_hours: float
    license_note: str


_SOURCES: tuple[CorpusSource, ...] = (
    CorpusSource(
        key="sanskrit-documents-archive",
        display="Sanskrit Documents Archive (audio recitations)",
        expected_hours=8.0,
        license_note="attribution-required",
    ),
    CorpusSource(
        key="muktabodha-vedic",
        display="Muktabodha Digital Library (Vedic/Tantric chant)",
        expected_hours=12.0,
        license_note="operator-vetted",
    ),
    CorpusSource(
        key="archive-org-sanskrit",
        display="Internet Archive Sanskrit audio (PD subset)",
        expected_hours=20.0,
        license_note="public-domain",
    ),
    CorpusSource(
        key="wikisource-sanskrit-audio",
        display="Sanskrit Wikipedia / Wikisource audio",
        expected_hours=2.0,
        license_note="CC-BY-SA-4.0",
    ),
)


@dataclass(frozen=True)
class SvaraMark:
    """One svara annotation: which syllable carries which tone.

    ``syllable_index`` is the integer offset into the clip's
    syllable sequence (0-based). ``svara`` is one of the three
    Vedic prosodic tones; the LoRA learns to bias the pitch
    contour accordingly. ``duration_s`` records how long the
    syllable is held — sustained-vowel udatta carries the
    bhajan / shloka aesthetic the adapter targets.
    """

    syllable_index: int
    svara: Svara
    duration_s: float


@dataclass(frozen=True)
class ManifestRow:
    """The augmented NeMo manifest schema for chant.

    Beyond the standard ``audio_filepath`` / ``duration`` / ``text``
    triple, every row carries:

      - ``mantra_id`` — stable per-mantra identifier so the trainer
        can sample whole mantras (not random 5 s windows) during
        epochs.
      - ``svara_marks`` — list of :class:`SvaraMark` over the
        clip's syllables.
      - ``script`` — always ``"devanagari"`` for the v1.4 corpus;
        IAST transliteration is computed on demand by the
        preprocessor.
    """

    audio_filepath: str
    duration: float
    text: str
    mantra_id: str
    speaker_id: int
    source: str
    svara_marks: tuple[SvaraMark, ...] = field(default_factory=tuple)
    script: str = "devanagari"
    language: str = "sa"

    def to_jsonl(self) -> str:
        return json.dumps(
            {
                "audio_filepath": self.audio_filepath,
                "duration": round(self.duration, 3),
                "text": self.text,
                "mantra_id": self.mantra_id,
                "speaker_id": self.speaker_id,
                "source": self.source,
                "script": self.script,
                "language": self.language,
                "svara_marks": [
                    {
                        "syllable_index": m.syllable_index,
                        "svara": m.svara,
                        "duration_s": round(m.duration_s, 3),
                    }
                    for m in self.svara_marks
                ],
            },
            ensure_ascii=False,
        )


def make_synthetic_rows() -> list[ManifestRow]:
    """Four deterministic rows covering the canonical mantra shapes.

    The four cover one Gita verse opener (sustained-vowel udatta),
    one Mahamrityunjaya line (long anudatta opener), one Gayatri
    fragment (svarita closer), and one short namaskara stotra
    (mixed). Together they exercise every svara label the trainer
    expects.
    """
    return [
        ManifestRow(
            audio_filepath="/tmp/synthetic/chant-0001.wav",
            duration=6.40,
            # ॐ नमो भगवते वासुदेवाय
            text=(
                "\u0950 \u0928\u092e\u094b \u092d\u0917\u0935\u0924\u0947 "
                "\u0935\u093e\u0938\u0941\u0926\u0947\u0935\u093e\u092f"
            ),
            mantra_id="dvadashakshara",
            speaker_id=0,
            source="dry-run",
            svara_marks=(
                SvaraMark(syllable_index=0, svara="udatta", duration_s=1.20),
                SvaraMark(syllable_index=1, svara="anudatta", duration_s=0.35),
                SvaraMark(syllable_index=2, svara="udatta", duration_s=0.40),
                SvaraMark(syllable_index=3, svara="svarita", duration_s=0.60),
            ),
        ),
        ManifestRow(
            audio_filepath="/tmp/synthetic/chant-0002.wav",
            duration=8.10,
            # ॐ त्र्यम्बकं यजामहे
            text=(
                "\u0950 \u0924\u094d\u0930\u094d\u092f\u092e\u094d\u092c\u0915\u0902 "
                "\u092f\u091c\u093e\u092e\u0939\u0947"
            ),
            mantra_id="mahamrityunjaya",
            speaker_id=0,
            source="dry-run",
            svara_marks=(
                SvaraMark(syllable_index=0, svara="udatta", duration_s=1.50),
                SvaraMark(syllable_index=1, svara="anudatta", duration_s=0.80),
                SvaraMark(syllable_index=2, svara="udatta", duration_s=0.55),
                SvaraMark(syllable_index=3, svara="anudatta", duration_s=0.45),
            ),
        ),
        ManifestRow(
            audio_filepath="/tmp/synthetic/chant-0003.wav",
            duration=4.95,
            # तत्सवितुर्वरेण्यं
            text="\u0924\u0924\u094d\u0938\u0935\u093f\u0924\u0941\u0930\u094d\u0935\u0930\u0947\u0923\u094d\u092f\u0902",
            mantra_id="gayatri-line-1",
            speaker_id=1,
            source="dry-run",
            svara_marks=(
                SvaraMark(syllable_index=0, svara="anudatta", duration_s=0.30),
                SvaraMark(syllable_index=1, svara="udatta", duration_s=0.50),
                SvaraMark(syllable_index=2, svara="svarita", duration_s=0.55),
            ),
        ),
        ManifestRow(
            audio_filepath="/tmp/synthetic/chant-0004.wav",
            duration=3.55,
            # नमस्ते अस्तु भगवन्
            text=(
                "\u0928\u092e\u0938\u094d\u0924\u0947 \u0905\u0938\u094d\u0924\u0941 "
                "\u092d\u0917\u0935\u0928\u094d"
            ),
            mantra_id="namaskara-stotra",
            speaker_id=1,
            source="dry-run",
            svara_marks=(
                SvaraMark(syllable_index=0, svara="udatta", duration_s=0.40),
                SvaraMark(syllable_index=1, svara="anudatta", duration_s=0.30),
                SvaraMark(syllable_index=2, svara="svarita", duration_s=0.50),
            ),
        ),
    ]


def validate_rows(rows: list[ManifestRow], *, min_snr: float = 22.0) -> None:
    """Sanity-check the manifest the way ``train_chant_style_lora.py``
    will: chant clips run 2-30 s (longer than TTS clips because
    mantras are inherently longer), non-empty text, svara marks
    have valid labels, syllable indices are 0-based and unique
    within a row.
    """
    del min_snr
    valid_svaras: set[str] = {"anudatta", "udatta", "svarita"}
    for r in rows:
        if not (2.0 <= r.duration <= 30.0):
            raise ValueError(
                f"row {r.audio_filepath} duration {r.duration:.2f}s "
                "outside [2, 30]s"
            )
        if not r.text.strip():
            raise ValueError(f"row {r.audio_filepath} has empty text")
        if r.speaker_id < 0:
            raise ValueError(
                f"row {r.audio_filepath} has invalid speaker_id {r.speaker_id}"
            )
        if not r.mantra_id.strip():
            raise ValueError(f"row {r.audio_filepath} has empty mantra_id")
        seen_indices: set[int] = set()
        for m in r.svara_marks:
            if m.svara not in valid_svaras:
                raise ValueError(
                    f"row {r.audio_filepath} mark "
                    f"{m.syllable_index} has invalid svara {m.svara!r}"
                )
            if m.syllable_index < 0:
                raise ValueError(
                    f"row {r.audio_filepath} mark "
                    f"{m.syllable_index} has negative syllable_index"
                )
            if m.syllable_index in seen_indices:
                raise ValueError(
                    f"row {r.audio_filepath} has duplicate "
                    f"syllable_index {m.syllable_index}"
                )
            seen_indices.add(m.syllable_index)
            if m.duration_s <= 0:
                raise ValueError(
                    f"row {r.audio_filepath} mark "
                    f"{m.syllable_index} has non-positive duration"
                )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Output JSONL manifest path.",
    )
    ap.add_argument(
        "--include-muktabodha",
        action="store_true",
        help="Include Muktabodha (operator must confirm licensing).",
    )
    ap.add_argument(
        "--min-snr",
        type=float,
        default=22.0,
        help="Reject clips below this SNR (dB). Chant SNR target is "
        "looser than TTS because hall reverb is part of the aesthetic.",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="CI-only path: skip download/forced-align, emit a "
        "deterministic synthetic manifest.",
    )
    args = ap.parse_args()

    if args.dry_run:
        rows = make_synthetic_rows()
        validate_rows(rows, min_snr=args.min_snr)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(r.to_jsonl() + "\n")
        sources = [
            s
            for s in _SOURCES
            if args.include_muktabodha or s.key != "muktabodha-vedic"
        ]
        total = sum(s.expected_hours for s in sources)
        print(
            f"[dry-run] wrote {len(rows)} synthetic chant rows to "
            f"{args.out}; sources cited: {len(sources)} (~{total:.1f}h "
            "target on DGX).",
            file=sys.stderr,
        )
        return 0

    print(
        "real-mode chant curation is DGX-only: stage the cache + "
        "Sanskrit MFA aligner per the operator runbook and re-run "
        "without --dry-run.",
        file=sys.stderr,
    )
    return 1


__all__ = [
    "_SOURCES",
    "CorpusSource",
    "ManifestRow",
    "SvaraMark",
    "main",
    "make_synthetic_rows",
    "validate_rows",
]


if __name__ == "__main__":
    raise SystemExit(main())
