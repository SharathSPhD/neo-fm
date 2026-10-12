"""audit/interpret read a finished result.json; no engine deps needed."""
import json
import subprocess
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ENGINE))
import pce_tools  # noqa: E402

GOOD = {
    "surface": "line one\nline two", "committed": "draft", "vimarsa_event": False, "vimarsa_novelty": 0.1,
    "posterior": [0.5, 0.3, 0.2], "embedder": "embeddinggemma@service",
    "audit": {"audit": {"two_pass": True, "bypassed": False, "selected_idx": 1, "delta_F_draft": 0.01, "delta_F_threshold": 0.05,
                        "ananda_scores_draft": [0.2, 0.6, 0.4], "ananda_scores_revision": [0.1, 0.2, 0.3],
                        "revision_differs_from_draft": True, "commit_policy": "event_gated"}},
}


def test_audit_passes_good_receipt() -> None:
    assert all(ok for _, ok, _ in pce_tools.audit(GOOD))


def test_audit_flags_bad_receipt() -> None:
    bad = json.loads(json.dumps(GOOD))
    bad["posterior"] = [0.5, 0.1]
    bad["audit"]["audit"]["two_pass"] = False
    bad["embedder"] = "lexical"
    failed = {n for n, ok, _ in pce_tools.audit(bad) if not ok}
    assert {"two-pass receipt", "posterior sums to 1", "embedder is multilingual service"} <= failed


def test_interpret_explains_draft_commit() -> None:
    text = pce_tools.interpret(GOOD)
    assert "Committed the draft" in text and "did not fire" in text and "#1" in text


def test_cli_exit_codes(tmp_path: Path) -> None:
    p = tmp_path / "result.json"
    p.write_text(json.dumps(GOOD))
    ok = subprocess.run([sys.executable, str(ENGINE / "pce_tools.py"), "audit", str(p)], capture_output=True, text=True)
    assert ok.returncode == 0
    bad = json.loads(json.dumps(GOOD)); bad["committed"] = "nope"
    p.write_text(json.dumps(bad))
    assert subprocess.run([sys.executable, str(ENGINE / "pce_tools.py"), "audit", str(p)], capture_output=True).returncode == 1
