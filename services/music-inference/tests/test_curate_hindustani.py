"""Tests for `scripts/curate_hindustani.py` (v1.4 Sprint 10)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import curate_hindustani  # noqa: E402


@pytest.fixture()
def manifest(tmp_path: Path) -> Path:
    p = tmp_path / "hindustani-sources.yaml"
    p.write_text(
        """
- source_id: saraga-hindustani-bhimsen-001
  title: Mile Sur Mera Tumhara
  artist: Bhimsen Joshi
  language: hi
  start_seconds: 0.0
  end_seconds: 30.0
  license: cc-by-nc-sa
  source_url: https://compmusic.upf.edu/saraga-hindustani/bhimsen

- source_id: saraga-hindustani-ali-akbar-001
  title: Raag Yaman alap
  artist: Ali Akbar Khan
  language: hi
  start_seconds: 12.0
  end_seconds: 42.0
  license: cc-by-nc-sa
  source_url: https://compmusic.upf.edu/saraga-hindustani/aak-yaman

- source_id: archive-tagore-1970
  title: Aji Bijon Ghare
  artist: Hemanta Mukherjee
  language: bn
  start_seconds: 0.0
  end_seconds: 28.0
  license: pd-india
  source_url: https://archive.org/details/tagore-bn-1970

- source_id: snaa-dhrupad-veda
  title: Dhrupad excerpt
  artist: Gundecha Brothers
  language: sa
  start_seconds: 0.0
  end_seconds: 22.0
  license: fair-use-§52
  source_url: https://sangeetnatak.org/dhrupad-veda
""".strip(),
        encoding="utf-8",
    )
    return p


def test_dry_run_accepts_hindi_bengali_sanskrit(
    manifest: Path, tmp_path: Path
) -> None:
    summary = curate_hindustani.run_dry(manifest, tmp_path / "corpus")
    assert summary["clip_count"] == 4
    assert summary["total_hours"] > 0


def test_rejects_telugu_language(tmp_path: Path) -> None:
    """Carnatic-language clips do not belong in the Hindustani corpus."""
    p = tmp_path / "bad.yaml"
    p.write_text(
        """
- source_id: x
  title: foo
  artist: bar
  language: te
  start_seconds: 0
  end_seconds: 10
  license: cc-by
  source_url: https://example.com
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"language='te'"):
        curate_hindustani.run_dry(p, tmp_path / "out")


def test_rejects_tamil_language(tmp_path: Path) -> None:
    p = tmp_path / "bad.yaml"
    p.write_text(
        """
- source_id: x
  title: foo
  artist: bar
  language: ta
  start_seconds: 0
  end_seconds: 10
  license: cc-by
  source_url: https://example.com
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"language='ta'"):
        curate_hindustani.run_dry(p, tmp_path / "out")


def test_split_is_deterministic(manifest: Path, tmp_path: Path) -> None:
    s1 = curate_hindustani.run_dry(manifest, tmp_path / "out-a")
    s2 = curate_hindustani.run_dry(manifest, tmp_path / "out-b")
    assert (
        s1["splits"]["train_clip_ids"] == s2["splits"]["train_clip_ids"]
    )


def test_full_stage_not_implemented_in_ci(
    manifest: Path, tmp_path: Path
) -> None:
    with pytest.raises(NotImplementedError):
        curate_hindustani.run_full(manifest, tmp_path / "out", stage="vad")
