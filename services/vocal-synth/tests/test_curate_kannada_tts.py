"""Tests for `scripts/curate_kannada_tts.py` (v1.4 Sprint 13)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.curate_kannada_tts import (  # noqa: E402
    ManifestRow,
    main,
    make_synthetic_rows,
    validate_rows,
)


def _run_main(argv: list[str]) -> int:
    saved = sys.argv[:]
    try:
        sys.argv = ["curate_kannada_tts.py", *argv]
        return main()
    finally:
        sys.argv = saved


def test_synthetic_rows_are_well_formed() -> None:
    rows = make_synthetic_rows()
    assert len(rows) == 2
    for r in rows:
        assert 1.0 <= r.duration <= 15.0
        assert r.text.strip()
        assert r.speaker_id >= 0


def test_validate_rejects_clip_outside_duration_range() -> None:
    bad = ManifestRow(
        audio_filepath="x.wav",
        duration=20.0,
        text="hi",
        speaker_id=0,
        source="test",
    )
    with pytest.raises(ValueError, match="outside"):
        validate_rows([bad])


def test_validate_rejects_empty_text() -> None:
    bad = ManifestRow(
        audio_filepath="x.wav",
        duration=2.0,
        text="   ",
        speaker_id=0,
        source="test",
    )
    with pytest.raises(ValueError, match="empty text"):
        validate_rows([bad])


def test_validate_rejects_negative_speaker_id() -> None:
    bad = ManifestRow(
        audio_filepath="x.wav",
        duration=2.0,
        text="hi",
        speaker_id=-1,
        source="test",
    )
    with pytest.raises(ValueError, match="invalid speaker_id"):
        validate_rows([bad])


def test_to_jsonl_round_trips() -> None:
    rows = make_synthetic_rows()
    parsed = [json.loads(r.to_jsonl()) for r in rows]
    assert parsed[0]["language"] == "kn"
    assert parsed[0]["speaker_id"] == 0
    assert parsed[0]["audio_filepath"].endswith("clip-0001.wav")


def test_dry_run_emits_two_row_manifest(tmp_path: Path) -> None:
    out = tmp_path / "manifest.jsonl"
    rc = _run_main(["--out", str(out), "--dry-run"])
    assert rc == 0
    rows = [
        json.loads(line) for line in out.read_text().splitlines() if line.strip()
    ]
    assert len(rows) == 2
    for row in rows:
        assert row["language"] == "kn"
        assert row["source"] == "dry-run"


def test_real_mode_refuses_in_ci(tmp_path: Path) -> None:
    """No --dry-run = the operator-only path. The script should
    return a non-zero exit, *not* attempt anything destructive."""
    out = tmp_path / "manifest.jsonl"
    rc = _run_main(["--out", str(out)])
    assert rc == 1
    # The output file must NOT have been created.
    assert not out.exists()
