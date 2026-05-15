"""Unit tests for `scripts/neo-fm-governor.py`.

Only the file-side state machine (`pause` / `resume` / `status`) is
covered here; the `drain --dsn` path needs a live Postgres so it's
exercised in the end-to-end harness instead.
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

# Load the CLI module from its file (it doesn't sit on sys.path).
_HERE = Path(__file__).resolve()
_CLI = _HERE.parents[2] / "scripts" / "neo-fm-governor.py"
_spec = importlib.util.spec_from_file_location("neo_fm_governor", _CLI)
assert _spec is not None and _spec.loader is not None
governor_cli = importlib.util.module_from_spec(_spec)
sys.modules["neo_fm_governor"] = governor_cli
_spec.loader.exec_module(governor_cli)


def _run(*argv: str) -> dict[str, object]:
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = governor_cli.main(list(argv))
    assert rc in (0, 3), f"CLI exited non-zero: {rc}; stdout={buf.getvalue()}"
    line = buf.getvalue().strip().splitlines()[-1]
    return json.loads(line)


def test_pause_writes_state_file(tmp_path: Path) -> None:
    state = tmp_path / "governor.state"
    out = _run(
        "--state-path",
        str(state),
        "pause",
        "--tenant",
        "llm-ft-7b",
        "--drain-seconds",
        "30",
    )
    assert out["ok"] is True
    assert out["stop_new_jobs"] is True
    assert out["tenant"] == "llm-ft-7b"
    assert state.exists()
    payload = json.loads(state.read_text())
    assert payload["stop_new_jobs"] is True
    assert payload["tenant"] == "llm-ft-7b"
    assert "drain_deadline" in payload


def test_resume_removes_state_file(tmp_path: Path) -> None:
    state = tmp_path / "governor.state"
    state.write_text(json.dumps({"stop_new_jobs": True, "tenant": "x"}))
    out = _run("--state-path", str(state), "resume")
    assert out["ok"] is True
    assert out["stop_new_jobs"] is False
    assert not state.exists()


def test_resume_on_already_clear_is_idempotent(tmp_path: Path) -> None:
    state = tmp_path / "governor.state"
    out = _run("--state-path", str(state), "resume")
    assert out["stop_new_jobs"] is False
    assert not state.exists()


def test_status_when_clear(tmp_path: Path) -> None:
    state = tmp_path / "governor.state"
    out = _run("--state-path", str(state), "status")
    assert out["stop_new_jobs"] is False
    assert out["tenant"] is None
    assert out["drain_deadline_ms"] is None


def test_status_when_paused(tmp_path: Path) -> None:
    state = tmp_path / "governor.state"
    _run("--state-path", str(state), "pause", "--tenant", "voice-synth", "--drain-seconds", "5")
    out = _run("--state-path", str(state), "status")
    assert out["stop_new_jobs"] is True
    assert out["tenant"] == "voice-synth"
    assert isinstance(out["drain_deadline_ms"], int)


def test_drain_without_dsn_just_pauses(tmp_path: Path) -> None:
    state = tmp_path / "governor.state"
    out = _run("--state-path", str(state), "drain", "--tenant", "llm")
    assert out["ok"] is True
    assert out["stop_new_jobs"] is True
