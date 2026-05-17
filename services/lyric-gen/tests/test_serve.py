"""HTTP-level tests for the lyric-gen FastAPI app."""

from __future__ import annotations

import hashlib
import hmac
import json as _json
import os
import time
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

# lifespan-skip env must be set *before* `app.serve` imports because the
# FastAPI app is instantiated at import time and registers the lifespan
# handler immediately.
os.environ["LYRIC_GEN_SKIP_LIFESPAN"] = "1"
os.environ.setdefault("LYRIC_GEN_HMAC_SECRET", "test-secret")

from app import model as model_module  # noqa: E402
from app.model import FakeLyricGenModel  # noqa: E402
from app.serve import app  # noqa: E402


@pytest.fixture(autouse=True)
def _fake_model() -> Iterator[None]:
    prior = model_module.get_active_model()
    model_module.set_active_model(FakeLyricGenModel())
    yield
    model_module.set_active_model(prior)


def _sign(body: bytes, secret: str = "test-secret", offset: int = 0) -> dict[str, str]:
    ts = str(int(time.time()) + offset)
    sig = hmac.new(
        secret.encode(), body + b"\n" + ts.encode("ascii"), hashlib.sha256
    ).hexdigest()
    return {
        "x-neofm-signature": sig,
        "x-neofm-timestamp": ts,
        "content-type": "application/json",
    }


def _generate_payload() -> dict[str, object]:
    return {
        "job_id": "00000000-0000-0000-0000-000000000001",
        "trace_id": "trace-1",
        "language": "hi",
        "style_family": "hindustani",
        "mood": "devotional",
        "prompt": "a short lyric about dawn",
        "raga_name": "bhairav",
        "seed": 7,
        "sections": [
            {"section_id": "mukhda-1", "section_type": "mukhda", "target_syllables": 12},
            {"section_id": "antara-1", "section_type": "antara", "target_syllables": 16},
        ],
    }


def test_healthz_reports_fake_backend() -> None:
    client = TestClient(app)
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is True
    assert body["model_version"] == "fake-lyric-gen-0.1.0"
    assert body["backend"] == "fake"
    assert body["phase"] == 7


def test_metrics_endpoint_exposes_prometheus_text() -> None:
    client = TestClient(app)
    client.get("/healthz")
    r = client.get("/metrics")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    body = r.text
    assert "neofm_lyric_gen_requests_total" in body
    assert 'route="/healthz"' in body
    assert "neofm_lyric_gen_request_latency_seconds_bucket" in body
    assert "neofm_lyric_gen_model_info" in body


def test_generate_rejects_without_hmac() -> None:
    client = TestClient(app)
    r = client.post("/v1/generate-lyric", json=_generate_payload())
    assert r.status_code == 401


def test_generate_rejects_stale_timestamp() -> None:
    client = TestClient(app)
    body = _json.dumps(_generate_payload()).encode()
    headers = _sign(body, offset=-3600)
    r = client.post("/v1/generate-lyric", content=body, headers=headers)
    assert r.status_code == 401


def test_generate_happy_path_returns_response() -> None:
    client = TestClient(app)
    body = _json.dumps(_generate_payload()).encode()
    headers = _sign(body)
    r = client.post("/v1/generate-lyric", content=body, headers=headers)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["backend"] == "fake"
    assert out["model_version"] == "fake-lyric-gen-0.1.0"
    assert len(out["sections"]) == 2
    section_ids = [s["section_id"] for s in out["sections"]]
    assert section_ids == ["mukhda-1", "antara-1"]
    assert all(s["lyrics"] for s in out["sections"])
    assert out["body"]


def test_generate_returns_503_when_model_missing() -> None:
    model_module.set_active_model(None)
    client = TestClient(app)
    body = _json.dumps(_generate_payload()).encode()
    r = client.post("/v1/generate-lyric", content=body, headers=_sign(body))
    assert r.status_code == 503


def test_generate_rejects_oversized_prompt() -> None:
    client = TestClient(app)
    payload = _generate_payload()
    payload["prompt"] = "x" * 4096
    body = _json.dumps(payload).encode()
    r = client.post("/v1/generate-lyric", content=body, headers=_sign(body))
    assert r.status_code == 422


def test_generate_rejects_unknown_style_family() -> None:
    client = TestClient(app)
    payload = _generate_payload()
    payload["style_family"] = "klezmer-fusion"  # not a v1.4 style
    body = _json.dumps(payload).encode()
    r = client.post("/v1/generate-lyric", content=body, headers=_sign(body))
    assert r.status_code == 422


def test_generate_rejects_unknown_language() -> None:
    client = TestClient(app)
    payload = _generate_payload()
    payload["language"] = "mr"  # Marathi not yet in the union
    body = _json.dumps(payload).encode()
    r = client.post("/v1/generate-lyric", content=body, headers=_sign(body))
    assert r.status_code == 422
