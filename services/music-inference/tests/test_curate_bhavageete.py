"""Tests for `scripts/curate_bhavageete.py`.

The CI path only exercises the validate-and-summarise stage; the real
download/VAD/MFA/caption stages are operator-driven on DGX.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import curate_bhavageete  # noqa: E402


@pytest.fixture()
def manifest(tmp_path: Path) -> Path:
    p = tmp_path / "bhavageete-sources.yaml"
    p.write_text(
        """
- source_id: air-bengaluru-bendre-1965
  title: Bayalu
  artist: Da Ra Bendre (composer)
  language: kn
  start_seconds: 12.0
  end_seconds: 42.0
  license: fair-use-§52
  source_url: https://archive.org/details/air-bendre-1965
  notes: AIR archive

- source_id: saraga-kn-ksn-1987
  title: K S Narasimhaswamy poem
  artist: unknown vocalist
  language: kn
  start_seconds: 0.0
  end_seconds: 28.5
  license: cc-by-nc-sa
  source_url: https://compmusic.upf.edu/saraga-kn/ksn-1987
""".strip(),
        encoding="utf-8",
    )
    return p


def test_load_and_validate(manifest: Path, tmp_path: Path) -> None:
    out = tmp_path / "corpus"
    summary = curate_bhavageete.run_dry(manifest, out)
    assert summary["clip_count"] == 2
    assert summary["total_hours"] > 0
    # Train+eval cover all clips, no overlap.
    train = set(summary["splits"]["train_clip_ids"])
    eval_ = set(summary["splits"]["eval_clip_ids"])
    assert train.isdisjoint(eval_)
    assert len(train) + len(eval_) == 2
    assert (out / "summary.json").exists()
    assert (out / "clips.jsonl").exists()
    # clips.jsonl must be deterministic JSON for byte-level reproducibility.
    text = (out / "clips.jsonl").read_text(encoding="utf-8")
    for line in text.strip().splitlines():
        json.loads(line)  # parseable
        # sorted keys are part of the contract; ensure first key is alphabetic
        first_key = line.split('"')[1]
        assert first_key == "artist"  # alphabetic sort starts with 'artist'


def test_validate_rejects_non_kannada(tmp_path: Path) -> None:
    p = tmp_path / "bad.yaml"
    p.write_text(
        """
- source_id: x
  title: foo
  artist: bar
  language: hi
  start_seconds: 0
  end_seconds: 10
  license: pd-india
  source_url: https://example.com
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="language='hi'"):
        curate_bhavageete.run_dry(p, tmp_path / "out")


def test_validate_rejects_unknown_license(tmp_path: Path) -> None:
    p = tmp_path / "bad.yaml"
    p.write_text(
        """
- source_id: x
  title: foo
  artist: bar
  language: kn
  start_seconds: 0
  end_seconds: 10
  license: All Rights Reserved
  source_url: https://example.com
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="license="):
        curate_bhavageete.run_dry(p, tmp_path / "out")


def test_validate_rejects_clip_longer_than_60s(tmp_path: Path) -> None:
    p = tmp_path / "bad.yaml"
    p.write_text(
        """
- source_id: x
  title: foo
  artist: bar
  language: kn
  start_seconds: 0
  end_seconds: 90
  license: cc-by
  source_url: https://example.com
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="longer than 60s"):
        curate_bhavageete.run_dry(p, tmp_path / "out")


def test_splits_are_deterministic(manifest: Path, tmp_path: Path) -> None:
    s1 = curate_bhavageete.run_dry(manifest, tmp_path / "a")
    s2 = curate_bhavageete.run_dry(manifest, tmp_path / "b")
    assert s1["splits"] == s2["splits"]
