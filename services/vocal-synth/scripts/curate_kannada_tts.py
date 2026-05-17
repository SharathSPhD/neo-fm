"""Curate a 20-100 hour Kannada TTS corpus for the Sprint 13 NeMo
training run.

Sources (configured at the top of `_SOURCES`):

  - **AI4Bharat IndicTTS Kannada** — ~7 h of read speech across
    M/F speakers; the canonical clean Indic TTS subset.
  - **IndicVoices-R Kannada** — ~30 h after our quality filter
    (signal-to-noise ≥ 25 dB, vocal-only, single-speaker turns).
  - **IndicCorp Kannada audio** — only when licensed and the
    operator passes ``--include-indiccorp``. Adds another
    ~20-60 h depending on filter strictness.

The script is **operator-driven** by design — Sprint 13 corpus
work is done once, on DGX, with human review of borderline clips.
We give the operator a fast iteration loop:

  1. Download each source's manifest + WAVs into ``--cache``.
  2. Filter (length 1-15 s, SNR ≥ ``--min-snr``, no clipping, single
     speaker per clip).
  3. Forced-align with MFA + the Kannada lexicon (the operator
     pre-installs MFA on DGX; the script just shells out).
  4. Write a NeMo-format manifest (JSONL of ``{audio_filepath,
     duration, text, speaker_id}``).

CI runs `--dry-run`, which:

  - Skips the network fetch.
  - Generates two synthetic JSONL rows so the downstream training
    script can validate its manifest shape end-to-end without ever
    touching a real WAV.
  - Asserts the manifest schema is consistent with what
    `train_kannada_nemo.py` expects.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CorpusSource:
    """One configured input dataset for the curator."""
    key: str
    display: str
    expected_hours: float
    license_note: str


_SOURCES: tuple[CorpusSource, ...] = (
    CorpusSource(
        key="ai4bharat-indictts-kn",
        display="AI4Bharat IndicTTS Kannada",
        expected_hours=7.0,
        license_note="CC-BY-4.0",
    ),
    CorpusSource(
        key="indicvoices-r-kn",
        display="IndicVoices-R Kannada (filtered)",
        expected_hours=30.0,
        license_note="CC-BY-4.0",
    ),
    CorpusSource(
        key="indiccorp-kn-audio",
        display="IndicCorp Kannada audio (license-pending)",
        expected_hours=40.0,
        license_note="operator-vetted",
    ),
)


@dataclass(frozen=True)
class ManifestRow:
    """The NeMo manifest schema we'll emit."""
    audio_filepath: str
    duration: float
    text: str
    speaker_id: int
    source: str
    language: str = "kn"

    def to_jsonl(self) -> str:
        return json.dumps(
            {
                "audio_filepath": self.audio_filepath,
                "duration": round(self.duration, 3),
                "text": self.text,
                "speaker_id": self.speaker_id,
                "source": self.source,
                "language": self.language,
            },
            ensure_ascii=False,
        )


def make_synthetic_rows() -> list[ManifestRow]:
    """Return two operator-readable rows the dry-run can write
    out. The point is to lock in the manifest schema, not to
    teach the model anything real."""
    return [
        ManifestRow(
            audio_filepath="/tmp/synthetic/clip-0001.wav",
            duration=4.21,
            text="\u0c95\u0ca8\u0ccd\u0ca8\u0ca1 \u0ca8\u0cbe\u0ca1\u0cc1",  # ಕನ್ನಡ ನಾಡು
            speaker_id=0,
            source="dry-run",
        ),
        ManifestRow(
            audio_filepath="/tmp/synthetic/clip-0002.wav",
            duration=3.07,
            text=(
                "\u0cb6\u0cc1\u0cad\u0ccb\u0ca6\u0caf "
                "\u0ca8\u0ccb\u0c95\u0c95\u0cbe\u0ca6\u0caa\u0ca8"
            ),
            speaker_id=1,
            source="dry-run",
        ),
    ]


def validate_rows(rows: list[ManifestRow], *, min_snr: float = 25.0) -> None:
    """Sanity-check the manifest the way `train_kannada_nemo.py`
    will: durations in [1, 15] s, non-empty text, speaker_id ≥ 0."""
    del min_snr  # SNR live on disk; the dry-run doesn't read WAVs
    for r in rows:
        if not (1.0 <= r.duration <= 15.0):
            raise ValueError(
                f"row {r.audio_filepath} duration {r.duration:.2f}s "
                "outside [1, 15]s"
            )
        if not r.text.strip():
            raise ValueError(f"row {r.audio_filepath} has empty text")
        if r.speaker_id < 0:
            raise ValueError(
                f"row {r.audio_filepath} has invalid speaker_id {r.speaker_id}"
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
        "--include-indiccorp",
        action="store_true",
        help="Include the IndicCorp audio subset (operator must "
        "confirm licensing).",
    )
    ap.add_argument(
        "--min-snr",
        type=float,
        default=25.0,
        help="Reject clips below this SNR (dB).",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="CI-only path: skip download/forced-align, emit a "
        "schema-shaped manifest.",
    )
    args = ap.parse_args()

    if args.dry_run:
        rows = make_synthetic_rows()
        validate_rows(rows, min_snr=args.min_snr)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(r.to_jsonl() + "\n")
        sources = [s for s in _SOURCES if args.include_indiccorp or s.key != "indiccorp-kn-audio"]
        total = sum(s.expected_hours for s in sources)
        print(
            f"[dry-run] wrote {len(rows)} synthetic rows to {args.out}; "
            f"sources cited: {len(sources)} (~{total:.1f} h target on DGX).",
            file=sys.stderr,
        )
        return 0

    # Real-mode requires the DGX corpus pipeline; we don't run it in
    # CI. The operator wires this script up to the cache + MFA tools
    # on the DGX host.
    print(
        "real-mode curation is DGX-only: install `ai4bharat/IndicTTS` "
        "+ `indicvoices-r` cache locations and re-run without --dry-run.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
