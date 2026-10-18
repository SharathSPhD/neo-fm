"""neo-fm PCE cascade service: the vendored Pratyabhijna engine (managed-agents/pce-engine) behind one stateless HTTP call.

POST /cascade  {"brief": {...brief.json...}, "generations": {"draft": [...], "revision": [...]}, "engine": {"url", "token"}?}
  -> 200 {"status": "needs", "kind": "draft"|"revision", "prompts": [...]}   the caller writes the candidates and calls again
  -> 200 {"status": "done", "result": {...result.json...}}
GET  /health
Auth: `Authorization: Bearer <CASCADE_TOKEN>`.

This runs the same driver (run_cascade.py) the Managed Agents sandbox runs, unmodified, in a subprocess per call: the
scoring is identical, only the language model moves from the agent to the host. `engine` (embedder URL + short-lived
token) is passed through the subprocess environment, never stored. Stateless; the caller owns the two-round loop.
"""
from __future__ import annotations

import hmac
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

ENGINE_DIR = Path(os.environ.get("ENGINE_DIR", str(Path(__file__).resolve().parent.parent.parent / "managed-agents" / "pce-engine")))
TIMEOUT_S = int(os.environ.get("CASCADE_TIMEOUT_S", "25"))
MAX_CANDIDATES, MAX_CHARS = 12, 6000

app = FastAPI(title="neo-fm pce cascade")


class Engine(BaseModel):
    url: str
    token: str


class Request(BaseModel):
    brief: dict
    generations: dict[str, list[str]] = Field(default_factory=lambda: {"draft": [], "revision": []})
    engine: Engine | None = None


def _authorized(given: str) -> bool:
    master = os.environ.get("CASCADE_TOKEN", "")
    return bool(master) and bool(given) and hmac.compare_digest(given.encode(), master.encode())


@app.get("/health")
def health() -> dict:
    return {"ok": True, "engine": (ENGINE_DIR / "run_cascade.py").exists()}


@app.post("/cascade")
def cascade(req: Request, authorization: str = Header(default="")) -> dict:
    if not _authorized(authorization.removeprefix("Bearer ").strip()):
        raise HTTPException(status_code=401, detail="unauthorized")
    for kind, texts in req.generations.items():
        if kind not in ("draft", "revision") or len(texts) > MAX_CANDIDATES or any(len(t) > MAX_CHARS for t in texts):
            raise HTTPException(status_code=422, detail="bad generations")
    if int(req.brief.get("K", 3)) > MAX_CANDIDATES:
        raise HTTPException(status_code=422, detail="K too large")
    env = {k: v for k, v in os.environ.items() if k not in ("CASCADE_TOKEN", "EMBED_URL", "EMBED_TOKEN")}
    if req.engine:
        env["EMBED_URL"], env["EMBED_TOKEN"] = req.engine.url, req.engine.token
    with tempfile.TemporaryDirectory() as td:
        wd = Path(td)
        (wd / "brief.json").write_text(json.dumps(req.brief), encoding="utf-8")
        (wd / "generations.json").write_text(json.dumps({"draft": [], "revision": [], **req.generations}), encoding="utf-8")
        try:
            p = subprocess.run([sys.executable, str(ENGINE_DIR / "run_cascade.py"), str(wd)], capture_output=True, text=True, env=env, timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="engine timeout")
        if p.returncode == 3:
            needs = json.loads((wd / "needs.json").read_text(encoding="utf-8"))
            return {"status": "needs", "kind": needs["kind"], "prompts": needs["prompts"]}
        if p.returncode == 0:
            return {"status": "done", "result": json.loads((wd / "result.json").read_text(encoding="utf-8"))}
        raise HTTPException(status_code=500, detail=f"engine failed ({p.returncode}): {p.stderr[-300:]}")
