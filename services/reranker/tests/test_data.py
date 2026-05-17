"""PreferencePairsDataset shape, weights, split determinism."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from neofm_reranker.data import PreferencePairsDataset, PreferenceRow


def _row(**overrides):
    base = {
        "winner_audio_path": "tracks/a.wav",
        "loser_audio_path": "tracks/b.wav",
        "style": "carnatic",
        "language": "hi",
        "vote_source": "compare-page",
    }
    base.update(overrides)
    return base


def test_from_dict_assigns_default_weight():
    row = PreferenceRow.from_dict(_row())
    assert row.weight == 1.0


def test_from_dict_assigns_tie_weight_for_tie_source():
    row = PreferenceRow.from_dict(_row(vote_source="compare-page-tie"))
    assert row.weight == pytest.approx(0.25)


def test_from_dict_respects_explicit_weight():
    row = PreferenceRow.from_dict(_row(weight=0.7))
    assert row.weight == pytest.approx(0.7)


def test_split_is_deterministic_for_same_seed():
    rows = [PreferenceRow.from_dict(_row(winner_audio_path=f"w{i}")) for i in range(10)]
    ds = PreferencePairsDataset(rows)
    a_train, a_val = ds.split(val_fraction=0.2, seed=42)
    b_train, b_val = ds.split(val_fraction=0.2, seed=42)
    assert [r.winner_audio_path for r in a_train] == [
        r.winner_audio_path for r in b_train
    ]
    assert [r.winner_audio_path for r in a_val] == [
        r.winner_audio_path for r in b_val
    ]


def test_split_rejects_out_of_range_val_fraction():
    ds = PreferencePairsDataset([])
    with pytest.raises(ValueError):
        ds.split(val_fraction=1.5)


def test_by_style_groups_rows():
    rows = [
        PreferenceRow.from_dict(_row(style="carnatic")),
        PreferenceRow.from_dict(_row(style="hindustani")),
        PreferenceRow.from_dict(_row(style="carnatic")),
    ]
    ds = PreferencePairsDataset(rows)
    grouped = ds.by_style()
    assert len(grouped["carnatic"]) == 2
    assert len(grouped["hindustani"]) == 1


def test_from_jsonl_round_trip(tmp_path: Path):
    rows = [_row(winner_audio_path=f"w{i}") for i in range(3)]
    path = tmp_path / "ds.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
    ds = PreferencePairsDataset.from_jsonl(path)
    assert len(ds) == 3
    assert ds[0].winner_audio_path == "w0"
