"""Tests for scripts/curate_sanskrit_chant.py (Sprint 14)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.curate_sanskrit_chant import (  # noqa: E402
    ManifestRow,
    SvaraMark,
    main,
    make_synthetic_rows,
    validate_rows,
)


def _run_main(argv: list[str]) -> int:
    saved = sys.argv[:]
    try:
        sys.argv = ["curate_sanskrit_chant.py", *argv]
        return main()
    finally:
        sys.argv = saved


def test_synthetic_rows_are_deterministic_and_cover_all_svaras() -> None:
    rows_a = make_synthetic_rows()
    rows_b = make_synthetic_rows()
    assert [r.to_jsonl() for r in rows_a] == [r.to_jsonl() for r in rows_b]
    seen: set[str] = set()
    for row in rows_a:
        for mark in row.svara_marks:
            seen.add(mark.svara)
    assert seen == {"udatta", "anudatta", "svarita"}


def test_synthetic_rows_cover_two_speakers() -> None:
    rows = make_synthetic_rows()
    assert {r.speaker_id for r in rows} == {0, 1}


def test_synthetic_rows_have_unique_mantra_ids() -> None:
    rows = make_synthetic_rows()
    ids = [r.mantra_id for r in rows]
    assert len(ids) == len(set(ids))
    assert all(mid.strip() for mid in ids)


def test_validate_rows_rejects_short_duration() -> None:
    rows = make_synthetic_rows()
    bad = ManifestRow(
        audio_filepath="/tmp/x.wav",
        duration=0.5,
        text="\u0950",
        mantra_id="x",
        speaker_id=0,
        source="dry-run",
    )
    with pytest.raises(ValueError, match=r"outside \[2, 30\]s"):
        validate_rows([*rows, bad])


def test_validate_rows_rejects_duplicate_syllable_index() -> None:
    bad = ManifestRow(
        audio_filepath="/tmp/x.wav",
        duration=3.0,
        text="\u0950",
        mantra_id="x",
        speaker_id=0,
        source="dry-run",
        svara_marks=(
            SvaraMark(syllable_index=0, svara="udatta", duration_s=0.5),
            SvaraMark(syllable_index=0, svara="anudatta", duration_s=0.3),
        ),
    )
    with pytest.raises(ValueError, match="duplicate syllable_index"):
        validate_rows([bad])


def test_validate_rows_rejects_empty_text() -> None:
    bad = ManifestRow(
        audio_filepath="/tmp/x.wav",
        duration=3.0,
        text="   ",
        mantra_id="x",
        speaker_id=0,
        source="dry-run",
    )
    with pytest.raises(ValueError, match="empty text"):
        validate_rows([bad])


def test_validate_rows_rejects_invalid_svara_label() -> None:
    bad = ManifestRow(
        audio_filepath="/tmp/x.wav",
        duration=3.0,
        text="\u0950",
        mantra_id="x",
        speaker_id=0,
        source="dry-run",
        svara_marks=(
            SvaraMark(syllable_index=0, svara="swarita", duration_s=0.5),  # type: ignore[arg-type]
        ),
    )
    with pytest.raises(ValueError, match=r"invalid svara"):
        validate_rows([bad])


def test_dry_run_writes_jsonl_with_expected_columns(tmp_path: Path) -> None:
    out = tmp_path / "chant.jsonl"
    rc = _run_main(["--out", str(out), "--dry-run"])
    assert rc == 0
    rows = [
        json.loads(line) for line in out.read_text(encoding="utf-8").splitlines() if line
    ]
    assert len(rows) == 4
    for r in rows:
        assert {
            "audio_filepath",
            "duration",
            "text",
            "mantra_id",
            "speaker_id",
            "source",
            "script",
            "language",
            "svara_marks",
        } <= set(r)
        assert r["language"] == "sa"
        assert r["script"] == "devanagari"


def test_real_mode_refuses_in_ci(tmp_path: Path) -> None:
    out = tmp_path / "chant.jsonl"
    rc = _run_main(["--out", str(out)])
    assert rc == 1
    assert not out.exists()
