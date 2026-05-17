"""HTTP-level tests for the cover-art-synth FastAPI app."""

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
os.environ["COVER_ART_SKIP_LIFESPAN"] = "1"
os.environ.setdefault("COVER_ART_HMAC_SECRET", "test-secret")

from app import model as model_module
from app.model import FakeCoverArtModel
from app.serve import app


@pytest.fixture(autouse=True)
def _fake_model() -> Iterator[None]:
    prior = model_module.get_active_model()
    model_module.set_active_model(FakeCoverArtModel())
    yield
    model_module.set_active_model(prior)


def _sign(body: bytes, secret: str = "test-secret", offset: int = 0) -> dict[str, str]:
    ts = str(int(time.time()) + offset)
    sig = hmac.new(secret.encode(), body + b"\n" + ts.encode("ascii"), hashlib.sha256).hexdigest()
    return {
        "x-neofm-signature": sig,
        "x-neofm-timestamp": ts,
        "content-type": "application/json",
    }


def test_healthz_reports_fake_backend() -> None:
    client = TestClient(app)
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is True
    assert body["model_version"] == "fake-cover-art-0.1.0"
    assert body["backend"] == "fake"
    assert body["phase"] == 6


def test_metrics_endpoint_exposes_prometheus_text() -> None:
    client = TestClient(app)
    client.get("/healthz")
    r = client.get("/metrics")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    body = r.text
    assert "neofm_cover_art_synth_requests_total" in body
    assert 'route="/healthz"' in body
    assert "neofm_cover_art_synth_request_latency_seconds_bucket" in body
    assert "neofm_cover_art_synth_model_info" in body


def test_generate_rejects_without_hmac() -> None:
    client = TestClient(app)
    r = client.post(
        "/v1/generate-cover",
        json={"job_id": "j", "prompt": "anything"},
    )
    assert r.status_code == 401


def test_generate_rejects_stale_timestamp() -> None:
    client = TestClient(app)
    body = _json.dumps({"job_id": "j", "prompt": "anything"}).encode()
    headers = _sign(body, offset=-3600)
    r = client.post("/v1/generate-cover", content=body, headers=headers)
    assert r.status_code == 401


def test_generate_happy_path_returns_png() -> None:
    client = TestClient(app)
    payload = {
        "job_id": "00000000-0000-0000-0000-000000000001",
        "trace_id": "trace-1",
        "prompt": "tabla in golden hour, watercolor, no text",
        "style_family": "hindustani",
        "seed": 42,
        "width": 64,
        "height": 64,
    }
    body = _json.dumps(payload).encode()
    headers = _sign(body)
    r = client.post("/v1/generate-cover", content=body, headers=headers)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    assert r.headers["X-NeoFM-Backend"] == "fake"
    assert r.headers["X-NeoFM-Job-Id"] == "00000000-0000-0000-0000-000000000001"
    assert r.content.startswith(b"\x89PNG\r\n\x1a\n")


def test_generate_returns_503_when_model_missing() -> None:
    model_module.set_active_model(None)
    client = TestClient(app)
    body = _json.dumps(
        {"job_id": "j", "prompt": "anything", "width": 64, "height": 64}
    ).encode()
    r = client.post("/v1/generate-cover", content=body, headers=_sign(body))
    assert r.status_code == 503


def test_generate_rejects_oversized_prompt() -> None:
    client = TestClient(app)
    body = _json.dumps(
        {"job_id": "j", "prompt": "x" * 4096, "width": 64, "height": 64}
    ).encode()
    r = client.post("/v1/generate-cover", content=body, headers=_sign(body))
    # Pydantic produces a 422 for max_length; that's the contract.
    assert r.status_code == 422
