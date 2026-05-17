"""Tests for `scripts/curate_tamil_folk.py`.

CI exercises the manifest-validate-and-summarise dry-run only; the
download / VAD / MFA stages are operator-driven on DGX. The bulk of
the logic is shared with curate_bhavageete via `_corpus_pipeline.py`,
so the tests here pin the Tamil-folk-specific knobs:
  - language is 'ta' (not 'kn')
  - cc-by-sa is allowed (it isn't for bhavageete)
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import curate_tamil_folk  # noqa: E402


@pytest.fixture()
def manifest(tmp_path: Path) -> Path:
    p = tmp_path / "tamil-folk-sources.yaml"
    p.write_text(
        """
- source_id: tnff-pongal-village-2018
  title: Parai-folk medley
  artist: Tamil Nadu Folklore Foundation troupe
  language: ta
  start_seconds: 0.0
  end_seconds: 28.0
  license: cc-by
  source_url: https://archive.org/details/tnff-pongal-2018

- source_id: saraga-ta-folk-village-2010
  title: Janapada
  artist: unknown vocalist
  language: ta
  start_seconds: 4.5
  end_seconds: 34.5
  license: cc-by-nc-sa
  source_url: https://compmusic.upf.edu/saraga-ta-folk/village-2010
""".strip(),
        encoding="utf-8",
    )
    return p


def test_load_validate_summarise(manifest: Path, tmp_path: Path) -> None:
    out = tmp_path / "corpus"
    summary = curate_tamil_folk.run_dry(manifest, out)
    assert summary["clip_count"] == 2
    assert summary["total_hours"] > 0


def test_validate_rejects_non_tamil_language(tmp_path: Path) -> None:
    p = tmp_path / "bad.yaml"
    p.write_text(
        """
- source_id: x
  title: foo
  artist: bar
  language: kn
  start_seconds: 0
  end_seconds: 10
  license: cc-by
  source_url: https://example.com
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"language='kn'"):
        curate_tamil_folk.run_dry(p, tmp_path / "out")


def test_allows_cc_by_sa(tmp_path: Path) -> None:
    """CC-BY-SA is permitted for Tamil-folk (it isn't for bhavageete) —
    BL Sounds Tamil folk releases use it.
    """
    p = tmp_path / "manifest.yaml"
    p.write_text(
        """
- source_id: bl-sounds-tamilfolk-1973
  title: BL Tamil folk archive
  artist: anon
  language: ta
  start_seconds: 0
  end_seconds: 20
  license: cc-by-sa
  source_url: https://sounds.bl.uk/tamil-1973
""".strip(),
        encoding="utf-8",
    )
    summary = curate_tamil_folk.run_dry(p, tmp_path / "out")
    assert summary["clip_count"] == 1


def test_pipeline_shared_with_bhavageete(tmp_path: Path) -> None:
    """Both curators wire into the same `_corpus_pipeline` primitives.

    This is essentially a smoke test: importing both and calling them
    against their respective manifests should not have side effects on
    each other. If a future refactor accidentally introduces global
    state in `_corpus_pipeline`, this catches it.
    """
    import curate_bhavageete

    bhav_manifest = tmp_path / "bhav.yaml"
    bhav_manifest.write_text(
        """
- source_id: x
  title: foo
  artist: bar
  language: kn
  start_seconds: 0
  end_seconds: 10
  license: cc-by
  source_url: https://example.com
""".strip(),
        encoding="utf-8",
    )
    tamil_manifest = tmp_path / "tamil.yaml"
    tamil_manifest.write_text(
        """
- source_id: y
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
    b = curate_bhavageete.run_dry(bhav_manifest, tmp_path / "bhav-out")
    t = curate_tamil_folk.run_dry(tamil_manifest, tmp_path / "tamil-out")
    assert b["clip_count"] == 1
    assert t["clip_count"] == 1
