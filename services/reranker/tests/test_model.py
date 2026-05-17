"""Reranker head: deterministic init, parameter count, forward shapes."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from neofm_reranker.model import (
    ENCODER_DIM,
    HeadConfig,
    RerankerHead,
    _deterministic_features,
)


def test_head_config_parameter_count_matches_layout():
    cfg = HeadConfig(in_dim=768, hidden_dim=64)
    assert cfg.parameter_count == 768 * 64 + 64 + 64 + 1


def test_head_param_count_under_60k():
    cfg = HeadConfig()
    assert cfg.parameter_count < 60_000


def test_head_init_is_deterministic_given_same_seed():
    a = RerankerHead.from_config(HeadConfig(init_seed=42))
    b = RerankerHead.from_config(HeadConfig(init_seed=42))
    assert a.w1 == b.w1
    assert a.b1 == b.b1
    assert a.w2 == b.w2
    assert a.b2 == b.b2


def test_head_init_differs_across_seeds():
    a = RerankerHead.from_config(HeadConfig(init_seed=1))
    b = RerankerHead.from_config(HeadConfig(init_seed=2))
    assert a.w2 != b.w2


def test_deterministic_features_shape():
    feats = _deterministic_features("tracks/x.wav")
    assert len(feats) == ENCODER_DIM
    assert all(-1.0 <= f <= 1.0 for f in feats)


def test_deterministic_features_stable_across_calls():
    a = _deterministic_features("tracks/x.wav")
    b = _deterministic_features("tracks/x.wav")
    assert a == b


def test_deterministic_features_differ_by_path():
    a = _deterministic_features("tracks/x.wav")
    b = _deterministic_features("tracks/y.wav")
    assert a != b


def test_forward_returns_finite_scalar():
    head = RerankerHead.from_config(HeadConfig())
    score = head.score("tracks/x.wav")
    assert isinstance(score, float)
    assert score == score  # not NaN


def test_forward_rejects_wrong_feature_dim():
    head = RerankerHead.from_config(HeadConfig(in_dim=4, hidden_dim=2))
    with pytest.raises(ValueError):
        head.forward([0.0, 1.0, 2.0])  # only 3 values
