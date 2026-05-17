"""Tests for the v1.4 Sprint 8 LoRA adapter plumbing in
`app.model.HeartMuLaModel`.

We can't (and don't want to) import heartlib/peft/torch in CI, so we
test the `_attach_adapter` / `_detach_adapter` orchestration via a
fake pipeline that mimics PEFT's `load_adapter` + `set_adapter` +
`disable_adapters` surface. This is enough to pin the behaviour:

  - The adapter is looked up by `style_family` from the registry.
  - On first request, `load_adapter` is called with the on-disk path.
  - On subsequent requests in the same style, `load_adapter` is NOT
    called again — only `set_adapter`.
  - After every generate(), `disable_adapters` runs so a follow-up
    request in a different style isn't biased.
  - Styles without a registered adapter never touch the pipeline.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.model import (
    GenerationRequest,
    GenerationSection,
    HeartMuLaModel,
    _style_adapters_from_env,
)


class _FakePeftLM:
    """Mimics the surface PEFT exposes on the wrapped LM."""

    def __init__(self) -> None:
        self.load_adapter = MagicMock()
        self.set_adapter = MagicMock()
        self.disable_adapters = MagicMock()


class _FakePipe:
    """Mimics enough of HeartMuLaGenPipeline for adapter wiring tests."""

    def __init__(self) -> None:
        self.mula = _FakePeftLM()

    def __call__(self, *_args: Any, **_kwargs: Any) -> None:
        # No-op: tests assert on the surrounding adapter calls, not the
        # generation itself.
        pass


def _section() -> GenerationSection:
    return GenerationSection(
        id="s1",
        type="pallavi",
        lyrics="bhayalu",
        transliteration="bhayalu",
        target_seconds=15,
    )


def _request(style: str) -> GenerationRequest:
    return GenerationRequest(
        job_id="j1",
        attempt_id=None,
        style_family=style,
        target_duration_seconds=15,
        sections=[_section()],
        output_format="wav",
        sample_rate=48000,
    )


def _wire(model: HeartMuLaModel, pipe: _FakePipe) -> None:
    """Bypass HeartMuLaModel.load() since heartlib isn't installed."""
    model._pipe = pipe  # type: ignore[attr-defined]
    model.model_loaded = True
    model.model_version = "test"


def test_attach_adapter_on_matching_style(tmp_path: Path) -> None:
    adapter = tmp_path / "bhavageete-v1"
    adapter.mkdir()
    model = HeartMuLaModel(
        ckpt_dir=tmp_path / "ckpt",
        style_adapters={"kannada-light-classical": adapter},
    )
    pipe = _FakePipe()
    _wire(model, pipe)

    name = model._attach_adapter("kannada-light-classical")
    assert name == "bhavageete-v1"
    pipe.mula.load_adapter.assert_called_once_with(
        str(adapter), adapter_name="bhavageete-v1"
    )
    pipe.mula.set_adapter.assert_called_once_with("bhavageete-v1")


def test_attach_adapter_caches_load_across_calls(tmp_path: Path) -> None:
    adapter = tmp_path / "bhavageete-v1"
    adapter.mkdir()
    model = HeartMuLaModel(
        ckpt_dir=tmp_path / "ckpt",
        style_adapters={"kannada-light-classical": adapter},
    )
    pipe = _FakePipe()
    _wire(model, pipe)

    model._attach_adapter("kannada-light-classical")
    model._attach_adapter("kannada-light-classical")
    # load_adapter is called once total; set_adapter is called per-attach.
    assert pipe.mula.load_adapter.call_count == 1
    assert pipe.mula.set_adapter.call_count == 2


def test_attach_adapter_noop_for_unregistered_style(tmp_path: Path) -> None:
    model = HeartMuLaModel(ckpt_dir=tmp_path / "ckpt", style_adapters={})
    pipe = _FakePipe()
    _wire(model, pipe)

    name = model._attach_adapter("western")
    assert name is None
    pipe.mula.load_adapter.assert_not_called()
    pipe.mula.set_adapter.assert_not_called()


def test_attach_adapter_fails_when_directory_missing(tmp_path: Path) -> None:
    missing = tmp_path / "does-not-exist"
    model = HeartMuLaModel(
        ckpt_dir=tmp_path / "ckpt",
        style_adapters={"kannada-light-classical": missing},
    )
    pipe = _FakePipe()
    _wire(model, pipe)
    with pytest.raises(RuntimeError, match="LoRA adapter directory"):
        model._attach_adapter("kannada-light-classical")


def test_detach_adapter_disables_after_generate(tmp_path: Path) -> None:
    adapter = tmp_path / "bhavageete-v1"
    adapter.mkdir()
    model = HeartMuLaModel(
        ckpt_dir=tmp_path / "ckpt",
        style_adapters={"kannada-light-classical": adapter},
    )
    pipe = _FakePipe()
    _wire(model, pipe)
    model._attach_adapter("kannada-light-classical")
    model._detach_adapter()
    pipe.mula.disable_adapters.assert_called_once()


def test_has_adapter_for_reports_registry(tmp_path: Path) -> None:
    adapter = tmp_path / "x"
    adapter.mkdir()
    model = HeartMuLaModel(
        ckpt_dir=tmp_path / "ckpt",
        style_adapters={"kannada-light-classical": adapter},
    )
    assert model.has_adapter_for("kannada-light-classical") is True
    assert model.has_adapter_for("western") is False


def test_style_adapters_from_env_reads_documented_env_vars(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bhav = tmp_path / "bhav"
    bhav.mkdir()
    tamil = tmp_path / "tamil"
    tamil.mkdir()
    monkeypatch.setenv("HEARTMULA_LORA_KANNADA_LIGHT_CLASSICAL", str(bhav))
    monkeypatch.setenv("HEARTMULA_LORA_TAMIL_FOLK", str(tamil))
    monkeypatch.delenv("HEARTMULA_LORA_CARNATIC", raising=False)
    mapping = _style_adapters_from_env()
    assert mapping["kannada-light-classical"] == bhav
    assert mapping["tamil-folk"] == tamil
    assert "carnatic" not in mapping


def test_style_adapters_from_env_empty_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    # Wipe all the v1.4 adapter env vars so the test is reproducible.
    for k in list(os.environ):
        if k.startswith("HEARTMULA_LORA_"):
            monkeypatch.delenv(k, raising=False)
    assert _style_adapters_from_env() == {}
