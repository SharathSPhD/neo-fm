"""Tests for `scripts/curate_carnatic.py` (v1.4 Sprint 10)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import curate_carnatic  # noqa: E402


@pytest.fixture()
def manifest(tmp_path: Path) -> Path:
    p = tmp_path / "carnatic-sources.yaml"
    p.write_text(
        """
- source_id: saraga-carnatic-tyagaraja-001
  title: Endaro Mahanubhavulu
  artist: Sanjay Subrahmanyan
  language: te
  start_seconds: 0.0
  end_seconds: 28.5
  license: cc-by-nc-sa
  source_url: https://compmusic.upf.edu/saraga-carnatic/endaro

- source_id: saraga-carnatic-dikshitar-001
  title: Vatapi Ganapatim Bhaje
  artist: Aruna Sairam
  language: sa
  start_seconds: 3.0
  end_seconds: 31.0
  license: cc-by-nc-sa
  source_url: https://compmusic.upf.edu/saraga-carnatic/vatapi

- source_id: charsur-papanasam-sivan
  title: Kaa Vaa Vaa
  artist: M. S. Subbulakshmi
  language: ta
  start_seconds: 0.0
  end_seconds: 25.0
  license: cc-by
  source_url: https://charsur.org/papanasam/kaa-vaa-vaa

- source_id: archive-air-purandara-1968
  title: Bhagyada Lakshmi Baaramma
  artist: M. S. Sheela
  language: kn
  start_seconds: 0.0
  end_seconds: 30.0
  license: fair-use-§52
  source_url: https://archive.org/details/air-chennai-1968-purandara
""".strip(),
        encoding="utf-8",
    )
    return p


def test_dry_run_accepts_all_four_carnatic_languages(
    manifest: Path, tmp_path: Path
) -> None:
    summary = curate_carnatic.run_dry(manifest, tmp_path / "corpus")
    assert summary["clip_count"] == 4
    assert summary["total_hours"] > 0
    assert set(summary["by_license_seconds"]) <= {
        "cc-by",
        "cc-by-nc-sa",
        "fair-use-§52",
    }


def test_rejects_hindi_language(tmp_path: Path) -> None:
    """Hindustani-language clips do not belong in the Carnatic corpus."""
    p = tmp_path / "bad.yaml"
    p.write_text(
        """
- source_id: x
  title: foo
  artist: bar
  language: hi
  start_seconds: 0
  end_seconds: 10
  license: cc-by
  source_url: https://example.com
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"language='hi'"):
        curate_carnatic.run_dry(p, tmp_path / "out")


def test_rejects_english_language(tmp_path: Path) -> None:
    p = tmp_path / "bad.yaml"
    p.write_text(
        """
- source_id: x
  title: foo
  artist: bar
  language: en
  start_seconds: 0
  end_seconds: 10
  license: cc-by
  source_url: https://example.com
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"language='en'"):
        curate_carnatic.run_dry(p, tmp_path / "out")


def test_split_is_deterministic(manifest: Path, tmp_path: Path) -> None:
    s1 = curate_carnatic.run_dry(manifest, tmp_path / "out-a")
    s2 = curate_carnatic.run_dry(manifest, tmp_path / "out-b")
    assert (
        s1["splits"]["train_clip_ids"] == s2["splits"]["train_clip_ids"]
    )
    assert s1["splits"]["eval_clip_ids"] == s2["splits"]["eval_clip_ids"]


def test_full_stage_not_implemented_in_ci(
    manifest: Path, tmp_path: Path
) -> None:
    """Anything past `validate` requires the operator on DGX."""
    with pytest.raises(NotImplementedError):
        curate_carnatic.run_full(manifest, tmp_path / "out", stage="vad")
