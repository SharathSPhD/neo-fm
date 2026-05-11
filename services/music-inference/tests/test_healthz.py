from __future__ import annotations

from fastapi.testclient import TestClient

from app.serve import app

client = TestClient(app)


def test_healthz_ok() -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is False
    assert body["phase"] == 0


def test_generate_returns_501_in_phase_0() -> None:
    payload = {
        "job_id": "00000000-0000-0000-0000-000000000000",
        "sections": [
            {"id": "s1", "target_seconds": 30, "lyrics": "hello", "language": "en"}
        ],
    }
    r = client.post("/v1/generate", json=payload)
    assert r.status_code == 501
    assert r.json()["detail"]["error"] == "phase_0_stub"


def test_generate_rejects_invalid_target_seconds() -> None:
    payload = {
        "job_id": "00000000-0000-0000-0000-000000000000",
        "sections": [{"id": "s1", "target_seconds": 9999}],
    }
    r = client.post("/v1/generate", json=payload)
    assert r.status_code == 422
