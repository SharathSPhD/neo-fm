"""Tests for `scripts/curate_stems.py` (v1.4 Sprint 11).

The stems curator reuses `_corpus_pipeline.py` from
services/music-inference; this test pins:
  - Language allow-list excludes English (no Western-pop bleed-in)
  - Max clip length is 8s (tighter than the 60s default)
  - All six Indic languages are accepted
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

# curate_stems imports from services/music-inference/scripts; make
# sure that's on the path too.
MUSIC_SCRIPTS = HERE.parent.parent / "music-inference" / "scripts"
sys.path.insert(0, str(MUSIC_SCRIPTS))

import curate_stems  # noqa: E402


@pytest.fixture()
def manifest(tmp_path: Path) -> Path:
    p = tmp_path / "stems.yaml"
    p.write_text(
        """
- source_id: saraga-tabla-tihai-001
  title: Tabla tihai isolated
  artist: anon
  language: hi
  start_seconds: 0.0
  end_seconds: 6.0
  license: cc-by-nc-sa
  source_url: https://compmusic.upf.edu/saraga-hindustani/tabla-tihai-1

- source_id: saraga-mridangam-korvai-001
  title: Mridangam korvai isolated
  artist: anon
  language: te
  start_seconds: 0.0
  end_seconds: 7.0
  license: cc-by-nc-sa
  source_url: https://compmusic.upf.edu/saraga-carnatic/mridangam-korvai-1

- source_id: bl-parai-break-001
  title: Parai break
  artist: anon
  language: ta
  start_seconds: 0.0
  end_seconds: 5.0
  license: cc-by-sa
  source_url: https://sounds.bl.uk/tamil-parai-1
""".strip(),
        encoding="utf-8",
    )
    return p


def test_dry_run_validates_and_summarises(manifest: Path, tmp_path: Path) -> None:
    summary = curate_stems.run_dry(manifest, tmp_path / "out")
    assert summary["clip_count"] == 3
    assert summary["total_hours"] > 0


def test_rejects_english_clip(tmp_path: Path) -> None:
    p = tmp_path / "bad.yaml"
    p.write_text(
        """
- source_id: x
  title: foo
  artist: bar
  language: en
  start_seconds: 0
  end_seconds: 5
  license: cc-by
  source_url: https://example.com
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"language='en'"):
        curate_stems.run_dry(p, tmp_path / "out")


def test_rejects_clip_longer_than_8s(tmp_path: Path) -> None:
    p = tmp_path / "bad.yaml"
    p.write_text(
        """
- source_id: x
  title: too long
  artist: bar
  language: hi
  start_seconds: 0
  end_seconds: 12
  license: cc-by
  source_url: https://example.com
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"longer than 8"):
        curate_stems.run_dry(p, tmp_path / "out")


def test_accepts_all_six_indic_languages(tmp_path: Path) -> None:
    """The curator must accept hi/kn/ta/te/bn/sa so any v1.4 style
    can train a stem for its preferred instrument."""
    p = tmp_path / "manifest.yaml"
    entries: list[str] = []
    for i, lang in enumerate(["hi", "kn", "ta", "te", "bn", "sa"]):
        entries.append(
            f"""
- source_id: s-{lang}-{i}
  title: t-{lang}
  artist: a
  language: {lang}
  start_seconds: 0
  end_seconds: 6
  license: cc-by
  source_url: https://example.com/{lang}
""".strip()
        )
    p.write_text("\n".join(entries), encoding="utf-8")
    summary = curate_stems.run_dry(p, tmp_path / "out")
    assert summary["clip_count"] == 6


def test_full_stage_not_implemented_in_ci(
    manifest: Path, tmp_path: Path
) -> None:
    with pytest.raises(NotImplementedError):
        curate_stems.run_full(manifest, tmp_path / "out", stage="isolate-stems")
