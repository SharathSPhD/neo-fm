"""Real engine, offline (lexical embedder): the service must reproduce the driver's two-round protocol."""
import os
import sys
from pathlib import Path

os.environ["CASCADE_TOKEN"] = "t0k"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import app as svc  # noqa: E402

client = TestClient(svc.app)
H = {"Authorization": "Bearer t0k"}
BRIEF = {"topic": "A lighthouse keeper missing the shore", "constraint": "four lines, wistful, singable",
         "must_avoid": ["moon and heart cliches"], "aspects": ["lighthouse", "shore"], "K": 3}
DRAFTS = [f"draft {i} the lamp turns slow above the rocks\nI count the ships that never stop\nsalt on the glass\nthe shore far off" for i in range(3)]


def test_rejects_missing_and_wrong_token() -> None:
    assert client.post("/cascade", json={"brief": BRIEF}).status_code == 401
    assert client.post("/cascade", json={"brief": BRIEF}, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_two_round_protocol_through_http() -> None:
    r = client.post("/cascade", json={"brief": BRIEF}, headers=H).json()
    assert r["status"] == "needs" and r["kind"] == "draft" and len(r["prompts"]) == 3
    r = client.post("/cascade", json={"brief": BRIEF, "generations": {"draft": DRAFTS}}, headers=H).json()
    assert r["status"] == "needs" and r["kind"] == "revision" and "Reviser brief:" in r["prompts"][0]
    revs = [f"revised {i} lighthouse shore line one\nline two keeper\nline three sea\nline four home" for i in range(3)]
    r = client.post("/cascade", json={"brief": BRIEF, "generations": {"draft": DRAFTS, "revision": revs}}, headers=H).json()
    assert r["status"] == "done" and r["result"]["surface"] and r["result"]["committed"] in ("draft", "revision")


def test_rejects_oversized_input() -> None:
    assert client.post("/cascade", json={"brief": {**BRIEF, "K": 99}}, headers=H).status_code == 422
    assert client.post("/cascade", json={"brief": BRIEF, "generations": {"draft": ["x" * 7000]}}, headers=H).status_code == 422
    assert client.post("/cascade", json={"brief": BRIEF, "generations": {"bogus": ["x"]}}, headers=H).status_code == 422
