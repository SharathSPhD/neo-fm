"""Unit tests for `app.model` -- the request → heartlib translation.

We don't import heartlib or torch here; we exercise the pure-Python
formatters and the `FakeMusicModel` directly."""

from __future__ import annotations

import io
import wave
from typing import Any

from app.model import (
    FakeMusicModel,
    GenerationRequest,
    GenerationSection,
    build_lyrics_block,
    build_tags_block,
)


def _section(**overrides: Any) -> GenerationSection:
    base: dict[str, Any] = dict(
        id="s",
        type="verse",
        lyrics=None,
        transliteration=None,
        target_seconds=10,
        tags=None,
    )
    base.update(overrides)
    return GenerationSection(**base)


def test_build_lyrics_block_uses_known_section_headers() -> None:
    sections = [
        _section(id="s1", type="intro", lyrics=""),
        _section(id="s2", type="verse", lyrics="line one\nline two"),
        _section(id="s3", type="prechorus", lyrics="bridge into chorus"),
        _section(id="s4", type="chorus", lyrics="hook"),
        _section(id="s5", type="bridge", lyrics="bridge"),
        _section(id="s6", type="outro", lyrics=""),
    ]
    out = build_lyrics_block(sections)
    assert "[Intro]" in out
    assert "[Verse]\nline one\nline two" in out
    assert "[Prechorus]" in out
    assert "[Chorus]\nhook" in out
    assert "[Bridge]\nbridge" in out
    assert "[Outro]" in out


def test_build_lyrics_block_unknown_type_falls_back_to_verse() -> None:
    out = build_lyrics_block([_section(type="random-future-section", lyrics="x")])
    assert "[Verse]\nx" in out
    assert "[Random" not in out


def test_build_lyrics_block_prefers_transliteration_over_lyrics() -> None:
    """HeartMuLa is trained on Latin-script lyrics; Phase 3 always
    supplies a transliteration alongside Devanagari/Tamil/Kannada
    text. Confirm we feed the model the transliteration."""
    sections = [
        _section(
            type="verse",
            lyrics="पोथी पढि पढि जग मुआ",
            transliteration="Pothi padhi padhi jag mua",
        )
    ]
    out = build_lyrics_block(sections)
    assert "Pothi padhi padhi jag mua" in out
    assert "पोथी" not in out


def test_build_lyrics_block_is_robust_to_empty_bodies() -> None:
    out = build_lyrics_block([_section(type="intro", lyrics=None)])
    # an instrumental intro still emits the header so the model knows
    # the structure
    assert out.startswith("[Intro]")
    assert out.endswith("\n")


def _request(
    *, style: str = "western", sections: list[GenerationSection] | None = None
) -> GenerationRequest:
    return GenerationRequest(
        job_id="j",
        attempt_id=None,
        style_family=style,
        target_duration_seconds=30,
        sections=sections or [_section()],
    )


def test_build_tags_block_starts_with_style_seed() -> None:
    out = build_tags_block(_request(style="western"))
    parts = out.split(",")
    assert parts[0] == "pop"
    assert "vocal" in parts


def test_build_tags_block_carnatic_style_seed() -> None:
    out = build_tags_block(_request(style="carnatic"))
    parts = out.split(",")
    assert parts[0] == "carnatic"
    assert "indian-classical" in parts


def test_build_tags_block_dedupes_and_preserves_first_seen_order() -> None:
    req = _request(
        style="western",
        sections=[
            _section(id="a", tags=["piano", "warm"]),
            _section(id="b", tags=["pop", "warm", "synth"]),
        ],
    )
    out = build_tags_block(req)
    parts = out.split(",")
    assert len(parts) == len(set(parts))  # deduped
    # "pop" first appears from style_family seed, so the section's "pop"
    # tag must NOT push it later in the list
    assert parts[0] == "pop"
    assert parts.index("piano") < parts.index("warm") < parts.index("synth")


def test_build_tags_block_handles_unknown_style_family() -> None:
    # forward-compat: an unrecognised style yields just the per-section
    # tags rather than erroring out
    out = build_tags_block(
        _request(style="ambient-experimental", sections=[_section(tags=["drone"])])
    )
    assert out == "drone"


def test_fake_music_model_returns_valid_wav() -> None:
    fake = FakeMusicModel()
    blob = fake.generate(_request())
    with wave.open(io.BytesIO(blob)) as w:
        assert w.getnchannels() == 1
        assert w.getsampwidth() == 2
        assert w.getframerate() == 48000
        assert w.getnframes() > 0
    assert fake.last_request is not None
    assert fake.last_request.job_id == "j"


def test_fake_music_model_records_translated_inputs() -> None:
    """Lets the HTTP-layer tests assert the model layer saw the right
    lyrics/tags without poking into private state."""
    fake = FakeMusicModel()
    req = _request(
        style="western",
        sections=[_section(type="chorus", lyrics="hook", tags=["uplifting"])],
    )
    fake.generate(req)
    assert "[Chorus]\nhook" in (fake.last_lyrics or "")
    assert "uplifting" in (fake.last_tags or "").split(",")


# --- Regression tests for the fake-model production guard -----------------
#
# Sprint 0 truth-up. Setting only MUSIC_INFERENCE_FAKE_MODEL=1 must NOT
# silently degrade a production container to deterministic silence. The
# operator has to opt in twice (MUSIC_INFERENCE_ALLOW_FAKE=1 alongside)
# so that a stray env-var inheritance from CI cannot survive to prod.


def test_initialise_from_env_refuses_fake_without_explicit_allow(
    monkeypatch: Any,
) -> None:
    """A single env var is not enough -- both knobs must be flipped."""
    import pytest

    from app import model as model_module

    monkeypatch.setenv("MUSIC_INFERENCE_FAKE_MODEL", "1")
    monkeypatch.delenv("MUSIC_INFERENCE_ALLOW_FAKE", raising=False)

    with pytest.raises(RuntimeError, match="MUSIC_INFERENCE_ALLOW_FAKE=1"):
        model_module.initialise_from_env()


def test_initialise_from_env_accepts_fake_when_both_set(monkeypatch: Any) -> None:
    """The opt-in path still works (used by phase0 Dockerfile + local smoke)."""
    from app import model as model_module

    monkeypatch.setenv("MUSIC_INFERENCE_FAKE_MODEL", "1")
    monkeypatch.setenv("MUSIC_INFERENCE_ALLOW_FAKE", "1")

    m = model_module.initialise_from_env()
    assert isinstance(m, FakeMusicModel)
    assert m.model_loaded is True
    # Restore the module-level singleton so we don't leak between tests.
    model_module.set_active_model(None)
