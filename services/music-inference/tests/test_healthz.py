from __future__ import annotations

import hashlib
import hmac
import json
import time

import pytest
from fastapi.testclient import TestClient

from app.serve import app

TEST_SECRET = "test-secret-do-not-use-in-production-32bytes"


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("MUSIC_INFERENCE_HMAC_SECRET", TEST_SECRET)
    return TestClient(app)


def _sign(body: bytes, ts: str, secret: str = TEST_SECRET) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        body + b"\n" + ts.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()


def test_healthz_is_unauthenticated_and_reports_phase(client: TestClient) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is False
    assert body["phase"] == 0


def test_generate_without_hmac_is_401(client: TestClient) -> None:
    payload = {
        "job_id": "00000000-0000-0000-0000-000000000000",
        "style_family": "western",
        "sections": [
            {
                "id": "s1",
                "type": "intro",
                "target_seconds": 30,
                "lyrics": "hello",
                "language": "en",
            }
        ],
    }
    r = client.post("/v1/generate", json=payload)
    assert r.status_code == 401


def test_generate_with_valid_hmac_returns_501_in_phase_0(client: TestClient) -> None:
    payload = {
        "job_id": "00000000-0000-0000-0000-000000000000",
        "style_family": "western",
        "sections": [
            {
                "id": "s1",
                "type": "intro",
                "target_seconds": 30,
                "lyrics": "hello",
                "language": "en",
            }
        ],
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ts = str(int(time.time()))
    r = client.post(
        "/v1/generate",
        content=body,
        headers={
            "content-type": "application/json",
            "x-neofm-timestamp": ts,
            "x-neofm-signature": _sign(body, ts),
        },
    )
    assert r.status_code == 501
    assert r.json()["detail"]["error"] == "phase_0_stub"


def test_generate_rejects_stale_timestamp(client: TestClient) -> None:
    payload = {
        "job_id": "00000000-0000-0000-0000-000000000000",
        "style_family": "western",
        "sections": [
            {"id": "s1", "type": "intro", "target_seconds": 30},
        ],
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ts = str(int(time.time()) - 3600)
    r = client.post(
        "/v1/generate",
        content=body,
        headers={
            "content-type": "application/json",
            "x-neofm-timestamp": ts,
            "x-neofm-signature": _sign(body, ts),
        },
    )
    assert r.status_code == 401


def test_generate_rejects_wrong_signature(client: TestClient) -> None:
    payload = {
        "job_id": "00000000-0000-0000-0000-000000000000",
        "style_family": "western",
        "sections": [
            {"id": "s1", "type": "intro", "target_seconds": 30},
        ],
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ts = str(int(time.time()))
    r = client.post(
        "/v1/generate",
        content=body,
        headers={
            "content-type": "application/json",
            "x-neofm-timestamp": ts,
            "x-neofm-signature": "deadbeef" * 8,
        },
    )
    assert r.status_code == 401


def test_generate_rejects_invalid_target_seconds(client: TestClient) -> None:
    payload = {
        "job_id": "00000000-0000-0000-0000-000000000000",
        "style_family": "western",
        "sections": [{"id": "s1", "type": "intro", "target_seconds": 9999}],
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ts = str(int(time.time()))
    r = client.post(
        "/v1/generate",
        content=body,
        headers={
            "content-type": "application/json",
            "x-neofm-timestamp": ts,
            "x-neofm-signature": _sign(body, ts),
        },
    )
    assert r.status_code == 422
