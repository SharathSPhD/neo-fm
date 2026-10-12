"""Two-round driver test: the vendored cascade runs unmodified with agent-written candidates."""
import json
import subprocess
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
BRIEF = {"topic": "Write four lines about a lighthouse keeper missing the shore", "constraint": "four lines, wistful, singable",
         "must_avoid": ["moon and heart cliches"], "aspects": ["lighthouse", "shore"], "K": 3}


def run(wd: Path) -> int:
    return subprocess.run([sys.executable, str(ENGINE / "run_cascade.py"), str(wd)], capture_output=True, text=True).returncode


def test_two_round_protocol(tmp_path: Path) -> None:
    (tmp_path / "brief.json").write_text(json.dumps(BRIEF))
    assert run(tmp_path) == 3
    n = json.loads((tmp_path / "needs.json").read_text())
    assert n["kind"] == "draft" and n["need"] == 3 and len(n["prompts"]) == 3
    (tmp_path / "generations.json").write_text(json.dumps({"draft": [
        "The lamp turns slow above the rocks\nI count the ships that never stop\nSalt on the glass, the shore far off\nMy loneliness a steady light",
        "Beam over water, night by night\nThe shore I left is out of sight\nI keep the flame for strangers' sake\nAnd dream of footsteps on the sand",
        "Stone tower breathing through the fog\nGulls carry letters from the shore\nI trim the wick and wait for dawn\nThe sea keeps every promise vague"], "revision": []}))
    assert run(tmp_path) == 3
    n = json.loads((tmp_path / "needs.json").read_text())
    assert n["kind"] == "revision" and "Reviser brief:" in n["prompts"][0]
    g = json.loads((tmp_path / "generations.json").read_text())
    g["revision"] = [f"revised {i} lighthouse shore line one\nline two of the keeper\nline three by the sea\nline four home" for i in range(3)]
    (tmp_path / "generations.json").write_text(json.dumps(g))
    assert run(tmp_path) == 0
    r = json.loads((tmp_path / "result.json").read_text())
    assert r["committed"] in ("draft", "revision") and r["surface"] and abs(sum(r["posterior"]) - 1) < 1e-4
    assert r["audit"]["audit"]["two_pass"] is True
