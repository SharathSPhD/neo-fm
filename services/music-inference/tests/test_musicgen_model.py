"""Tests for `app/musicgen_model.py` — prompt building and adapter env.

The wrapper itself can't be unit-tested in CI (no audiocraft, no GPU),
but the pure-data helpers (`build_musicgen_prompt`,
`style_adapters_from_env`) can. The full load/generate path is
covered by Sprint 10's runbook step that operators execute on DGX
before the merge to main.
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest import mock

from app.model import GenerationRequest, GenerationSection
from app.musicgen_model import (
    MusicGenInferenceParams,
    build_musicgen_prompt,
    style_adapters_from_env,
)


def _req(style_family: str, **kwargs: object) -> GenerationRequest:
    base = {
        "job_id": "job-mg",
        "attempt_id": None,
        "style_family": style_family,
        "target_duration_seconds": 30,
        "sections": [
            GenerationSection(
                id="s1",
                type="verse",
                target_seconds=30,
                tags=["solo", "instrumental"],
            )
        ],
    }
    base.update(kwargs)
    return GenerationRequest(**base)  # type: ignore[arg-type]


def test_prompt_carnatic_includes_style_tag_set() -> None:
    p = build_musicgen_prompt(_req("carnatic", tempo_bpm=120, tala="adi"))
    assert "carnatic" in p
    assert "tala adi" in p
    assert "120 bpm" in p


def test_prompt_hindustani_includes_style_tag_set() -> None:
    p = build_musicgen_prompt(_req("hindustani", tempo_bpm=90, tala="teentaal"))
    assert "hindustani" in p
    assert "tala teentaal" in p
    assert "90 bpm" in p


def test_prompt_handles_missing_tempo() -> None:
    p = build_musicgen_prompt(_req("carnatic"))
    assert "bpm" not in p
    assert "carnatic" in p


def test_prompt_dedupes_tags() -> None:
    """`build_tags_block` dedupes; the prompt builder should preserve
    that."""
    p = build_musicgen_prompt(_req("carnatic"))
    # `vocal` appears once in style tags; section tags don't repeat.
    assert p.count("carnatic") == 1


def test_style_adapters_from_env_picks_known_styles() -> None:
    env = {
        "MUSICGEN_LORA_CARNATIC": "/mnt/models/lora/musicgen-carnatic-v1",
        "MUSICGEN_LORA_HINDUSTANI": "/mnt/models/lora/musicgen-hindustani-v1",
        # Not a MusicGen LoRA — should not show up.
        "HEARTMULA_LORA_TAMIL_FOLK": "/mnt/models/lora/heartmula-tamil-folk-v1",
    }
    with mock.patch.dict(os.environ, env, clear=False):
        adapters = style_adapters_from_env()
    assert "carnatic" in adapters
    assert "hindustani" in adapters
    assert "tamil-folk" not in adapters
    assert adapters["carnatic"] == Path(
        "/mnt/models/lora/musicgen-carnatic-v1"
    )


def test_style_adapters_from_env_skips_unset_vars() -> None:
    # Clear any existing musicgen env vars that the dev shell may have
    # set; `clear=True` ensures the env starts empty inside the patch.
    with mock.patch.dict(os.environ, {}, clear=True):
        adapters = style_adapters_from_env()
    assert adapters == {}


def test_musicgen_params_defaults_align_with_audiocraft_readme() -> None:
    """Pin defaults so a copy-paste regression to top_p > 0 or
    cfg_coef = 1.0 fails CI."""
    p = MusicGenInferenceParams()
    assert p.duration_max_seconds == 30.0
    assert p.top_k == 250
    assert p.top_p == 0.0
    assert p.temperature == 1.0
    assert p.cfg_coef == 3.5
    assert p.two_step_cfg is False
