from __future__ import annotations

import hashlib
import hmac
import os
import time
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

# We need lifespan to be skipped *before* `app.serve` imports because the
# FastAPI app is instantiated at import time and registers the lifespan
# handler immediately.
os.environ["VOCAL_SYNTH_SKIP_LIFESPAN"] = "1"
os.environ.setdefault("VOCAL_SYNTH_HMAC_SECRET", "test-secret")

from app import model as model_module  # noqa: E402
from app.model import FakeVocalModel  # noqa: E402
from app.serve import app  # noqa: E402


@pytest.fixture(autouse=True)
def _fake_model() -> Iterator[None]:
    prior = model_module.get_active_model()
    model_module.set_active_model(FakeVocalModel())
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


def test_healthz_unauthenticated() -> None:
    client = TestClient(app)
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is True
    assert body["model_version"] == "fake-vocal-0.1.0"
    assert body["phase"] == 5


def test_vocalize_rejects_without_hmac() -> None:
    client = TestClient(app)
    r = client.post("/v1/vocalize", json={"job_id": "j", "language": "hi"})
    assert r.status_code == 401


def test_vocalize_rejects_stale_timestamp() -> None:
    client = TestClient(app)
    body = b'{"job_id":"j"}'
    headers = _sign(body, offset=-3600)
    r = client.post("/v1/vocalize", content=body, headers=headers)
    assert r.status_code == 401


def test_vocalize_happy_path_returns_wav() -> None:
    client = TestClient(app)
    payload = {
        "job_id": "00000000-0000-0000-0000-000000000001",
        "trace_id": "trace-1",
        "language": "hi",
        "style_family": "hindustani",
        "voice_timbre": "female",
        "sample_rate": 24000,
        "target_duration_seconds": 4,
        "sections": [
            {
                "id": "verse-1",
                "type": "verse",
                "lyrics": "saanjh dhal gayi",
                "language": "hi",
                "script": "devanagari",
                "target_seconds": 4,
            }
        ],
    }
    body = (
        b'{"job_id":"00000000-0000-0000-0000-000000000001",'
        b'"trace_id":"trace-1","language":"hi","style_family":"hindustani",'
        b'"voice_timbre":"female","sample_rate":24000,'
        b'"target_duration_seconds":4,"sections":[{"id":"verse-1",'
        b'"type":"verse","lyrics":"saanjh dhal gayi","language":"hi",'
        b'"script":"devanagari","target_seconds":4}]}'
    )
    # Use the canonical JSON encoder for the actual body, then sign that.
    import json as _json

    body = _json.dumps(payload).encode()
    headers = _sign(body)
    r = client.post("/v1/vocalize", content=body, headers=headers)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "audio/wav"
    assert r.headers["X-NeoFM-Job-Id"] == "00000000-0000-0000-0000-000000000001"
    assert r.content[:4] == b"RIFF"
    assert r.content[8:12] == b"WAVE"
    # 4 seconds at 24 kHz mono PCM-16 = ~192_000 bytes data + 44 header.
    assert 190_000 < len(r.content) < 200_000


def test_vocalize_returns_503_when_model_missing() -> None:
    model_module.set_active_model(None)
    client = TestClient(app)
    import json as _json

    body = _json.dumps(
        {
            "job_id": "j",
            "language": "hi",
            "style_family": "hindustani",
            "sample_rate": 24000,
            "target_duration_seconds": 1,
            "sections": [
                {"id": "s", "type": "verse", "lyrics": "x", "target_seconds": 1}
            ],
        }
    ).encode()
    r = client.post("/v1/vocalize", content=body, headers=_sign(body))
    assert r.status_code == 503
