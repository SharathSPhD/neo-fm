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


# --- embedder best-effort: a refused token (e.g. the Cloud Run embedder predates v2 job-bound tokens) or a dead
# --- service must degrade to the lexical embedder, never fail the run.
import threading  # noqa: E402
from http.server import BaseHTTPRequestHandler, HTTPServer  # noqa: E402

import pytest  # noqa: E402


class _Refuse(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        self.send_response(401)
        self.end_headers()
        self.wfile.write(b'{"detail":"unauthorized"}')

    def log_message(self, *a: object) -> None:  # silence
        pass


def _drive_to_done(wd: Path, env: dict[str, str]) -> dict:
    import os

    def go() -> int:
        return subprocess.run([sys.executable, str(ENGINE / "run_cascade.py"), str(wd)], capture_output=True, text=True,
                              env={**os.environ, **env}).returncode

    (wd / "brief.json").write_text(json.dumps(BRIEF))
    assert go() == 3
    (wd / "generations.json").write_text(json.dumps({"draft": [f"draft {i} lighthouse shore line\nline two\nline three\nline four" for i in range(3)], "revision": []}))
    assert go() == 3
    g = json.loads((wd / "generations.json").read_text())
    g["revision"] = [f"revised {i} lighthouse shore line\nline two\nline three\nline four" for i in range(3)]
    (wd / "generations.json").write_text(json.dumps(g))
    assert go() == 0
    return json.loads((wd / "result.json").read_text())


def test_embedder_refuses_token_falls_back_to_lexical(tmp_path: Path) -> None:
    srv = HTTPServer(("127.0.0.1", 0), _Refuse)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        r = _drive_to_done(tmp_path, {"EMBED_URL": f"http://127.0.0.1:{srv.server_port}", "EMBED_TOKEN": "v2.9999999999.job.bad"})
    finally:
        srv.shutdown()
    assert r["surface"] and r["committed"] in ("draft", "revision")
    assert not r["embedder"].endswith("@service")  # lexical, not the service
    assert "401" in r["embedder_fallback"]


def test_embedder_unreachable_falls_back_to_lexical(tmp_path: Path) -> None:
    r = _drive_to_done(tmp_path, {"EMBED_URL": "http://127.0.0.1:9", "EMBED_TOKEN": "x"})  # nothing listens on port 9
    assert r["surface"] and r["embedder_fallback"] and not r["embedder"].endswith("@service")


def test_no_embedder_configured_has_no_fallback_note(tmp_path: Path) -> None:
    r = _drive_to_done(tmp_path, {"EMBED_URL": "", "EMBED_TOKEN": ""})
    assert r["embedder_fallback"] is None
