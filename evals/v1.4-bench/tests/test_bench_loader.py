"""Pin v1.4-bench prompt-file shape.

Detects: missing styles, drift in prompt count, malformed `expected`
mappings, missing required fields. Runs in CI without any heavy deps
(the loader avoids pyyaml deliberately).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(ROOT))

from bench_loader import (
    EXPECTED_STYLES,
    PROMPTS_PER_STYLE,
    Prompt,
    load_all,
    load_style,
)


def test_load_all_returns_100_prompts():
    prompts = load_all()
    assert len(prompts) == len(EXPECTED_STYLES) * PROMPTS_PER_STYLE


def test_every_style_has_exactly_ten_prompts():
    for style in EXPECTED_STYLES:
        prompts = load_style(style)
        assert len(prompts) == PROMPTS_PER_STYLE, (
            f"{style} has {len(prompts)} prompts, expected {PROMPTS_PER_STYLE}"
        )


def test_prompt_ids_are_unique_across_the_bench():
    ids = [p.id for p in load_all()]
    assert len(set(ids)) == len(ids), "prompt id collision detected"


def test_every_prompt_has_voice_persona_and_lyrics_seed():
    for p in load_all():
        assert isinstance(p, Prompt)
        assert p.expected.voice_persona, f"{p.id} missing voice_persona"
        assert p.lyrics_seed, f"{p.id} missing lyrics_seed"
        assert p.duration_seconds > 0, (
            f"{p.id} duration_seconds={p.duration_seconds}"
        )


def test_style_field_matches_filename():
    for style in EXPECTED_STYLES:
        for p in load_style(style):
            assert p.style == style, (
                f"prompt {p.id} declares style={p.style!r} in {style}.yaml"
            )


def test_load_style_rejects_unknown_style(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        load_style("not-a-real-style")
