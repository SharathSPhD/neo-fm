"""FastAPI surface tests for stems-synth.

Uses the FakeStemModel to keep CI off GPUs. Covers:
  - 200 happy path with a preset
  - 200 happy path with a free-text prompt
  - 422 when both `preset` and `prompt` are missing
  - 422 when both are provided
  - 422 when the preset name is unknown
  - 401 when the HMAC secret is unset
  - 401 when the signature is wrong
  - 503 when the model isn't loaded
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
import wave
from io import BytesIO
from typing import Any

import pytest
from fastapi.testclient import TestClient

# Tell the lifespan to skip the eager-load — tests install a fake.
os.environ["STEMS_SYNTH_SKIP_LIFESPAN"] = "1"
os.environ["STEMS_SYNTH_HMAC_SECRET"] = "test-secret"

from app import model as model_module
from app.model import FakeStemModel
from app.serve import app


@pytest.fixture(autouse=True)
def _install_fake() -> Any:
    model_module.set_active_model(FakeStemModel())
    yield
    model_module.set_active_model(None)


def _sign(body: bytes, secret: bytes, ts: int) -> str:
    payload = body + b"\n" + str(ts).encode("ascii")
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def _post(
    client: TestClient,
    body: dict[str, Any],
    *,
    secret: bytes = b"test-secret",
    ts: int | None = None,
    bad_sig: bool = False,
) -> Any:
    import json

    raw = json.dumps(body, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ts = ts if ts is not None else int(time.time())
    sig = _sign(raw, secret, ts)
    if bad_sig:
        sig = "0" * 64
    return client.post(
        "/v1/generate-stem",
        content=raw,
        headers={
            "content-type": "application/json",
            "x-neofm-signature": sig,
            "x-neofm-timestamp": str(ts),
            "x-neofm-trace-id": "trace-abc",
        },
    )


def _decode_wav(buf: bytes) -> tuple[int, int, int]:
    with wave.open(BytesIO(buf), "rb") as w:
        return w.getnchannels(), w.getframerate(), w.getnframes()


def test_healthz_lists_presets_and_loaded_state() -> None:
    with TestClient(app) as client:
        resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["model_loaded"] is True
    assert body["backend"] == "fake"
    assert "tabla_tihai" in body["presets"]
    assert "mridangam_korvai" in body["presets"]
    assert "parai_break" in body["presets"]
    assert "tanpura_drone" in body["presets"]


def test_metrics_endpoint_renders() -> None:
    with TestClient(app) as client:
        resp = client.get("/metrics")
    assert resp.status_code == 200
    assert b"stems_synth" in resp.content


def test_generate_with_preset_returns_wav() -> None:
    with TestClient(app) as client:
        resp = _post(
            client,
            {
                "job_id": "job-1",
                "style_family": "hindustani",
                "preset": "tabla_tihai",
                "duration_seconds": 6.0,
            },
        )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "audio/wav"
    assert resp.headers["x-neofm-backend"] == "fake"
    assert resp.headers["x-neofm-preset"] == "tabla_tihai"
    channels, sr, frames = _decode_wav(resp.content)
    assert channels == 1
    assert sr == 44100
    assert abs(frames - int(6.0 * 44100)) < 100


def test_generate_with_free_prompt_returns_wav() -> None:
    with TestClient(app) as client:
        resp = _post(
            client,
            {
                "job_id": "job-2",
                "style_family": "bollywood-ballad",
                "prompt": "dholak break, fast",
                "duration_seconds": 5.0,
            },
        )
    assert resp.status_code == 200, resp.text
    assert resp.headers["x-neofm-preset"] == ""
    _, sr, frames = _decode_wav(resp.content)
    assert sr == 44100
    assert abs(frames - int(5.0 * 44100)) < 100


def test_generate_rejects_both_preset_and_prompt() -> None:
    with TestClient(app) as client:
        resp = _post(
            client,
            {
                "job_id": "job-3",
                "style_family": "hindustani",
                "preset": "tabla_tihai",
                "prompt": "but also some free text",
            },
        )
    assert resp.status_code == 422


def test_generate_rejects_neither_preset_nor_prompt() -> None:
    with TestClient(app) as client:
        resp = _post(
            client,
            {
                "job_id": "job-4",
                "style_family": "hindustani",
            },
        )
    assert resp.status_code == 422


def test_generate_rejects_unknown_preset() -> None:
    with TestClient(app) as client:
        resp = _post(
            client,
            {
                "job_id": "job-5",
                "style_family": "hindustani",
                "preset": "not-a-real-preset",
            },
        )
    assert resp.status_code == 422


def test_generate_401_on_bad_signature() -> None:
    with TestClient(app) as client:
        resp = _post(
            client,
            {
                "job_id": "job-6",
                "style_family": "hindustani",
                "preset": "tabla_tihai",
            },
            bad_sig=True,
        )
    assert resp.status_code == 401


def test_generate_503_when_model_not_loaded() -> None:
    model_module.set_active_model(None)
    with TestClient(app) as client:
        resp = _post(
            client,
            {
                "job_id": "job-7",
                "style_family": "hindustani",
                "preset": "tabla_tihai",
            },
        )
    assert resp.status_code == 503
    body = resp.json()
    assert body["detail"]["error"] == "model_not_loaded"


def test_generate_401_when_hmac_secret_unset() -> None:
    """If the operator forgot to set the env var, the middleware
    must refuse the request rather than silently passing it."""
    prev = os.environ.pop("STEMS_SYNTH_HMAC_SECRET", None)
    try:
        with TestClient(app) as client:
            resp = client.post(
                "/v1/generate-stem",
                json={"job_id": "x", "style_family": "hindustani", "preset": "tabla_tihai"},
                headers={
                    "x-neofm-signature": "0" * 64,
                    "x-neofm-timestamp": str(int(time.time())),
                },
            )
        assert resp.status_code == 401
    finally:
        if prev is not None:
            os.environ["STEMS_SYNTH_HMAC_SECRET"] = prev
