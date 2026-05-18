"""Tests for the pwm-api HTTP surface.

We don't run torch or the real PWM backend here. The `client` fixture
installs a `FakePWMBackend` and skips the lifespan import, so every test
exercises the wrapper logic without hitting the DGX-only ML stack.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from collections.abc import Iterator
from typing import Any

# Ensure the wrapper skips its real-backend import path before we import
# ``serve``. Tests own the backend lifecycle via ``set_backend`` /
# ``reset_backend``.
os.environ.setdefault("PWM_SKIP_BACKEND_IMPORT", "1")

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

import serve

TEST_SECRET = "test-secret-do-not-use-in-production-32bytes"


# --- fake PWM backend -----------------------------------------------------


class _FakeGenerateRequest(BaseModel):
    """Mirror of PWM's ``api.main.GenerateRequest`` -- only the fields
    the wrapper sends are required."""

    domain: str
    language: str
    theme: str = ""
    music_context: dict[str, Any] = {}


class FakePWMBackend:
    """In-process stand-in for the real PWM backend.

    Records the most recent ``GenerateRequest`` for assertions, and lets
    a test override the ``text`` / ``sections`` the wrapper sees back.
    """

    GenerateRequest = _FakeGenerateRequest

    def __init__(self) -> None:
        self.last_request: _FakeGenerateRequest | None = None
        self.next_text: str = (
            "[Pallavi]\nFirst opening line\nSecond opening line\n\n"
            "[Anupallavi]\nThird line of the second section\n"
            "Fourth line of the second section\n"
        )
        self.next_sections: list[dict[str, Any]] | None = None
        self.next_status: str = "complete"
        self.next_error: str | None = None
        self._job_seq = 0

    async def generate(self, req: _FakeGenerateRequest) -> dict[str, Any]:
        self.last_request = req
        self._job_seq += 1
        return {"job_id": f"fake-job-{self._job_seq}", "status": "queued"}

    async def get_result(self, job_id: str) -> dict[str, Any]:
        result: dict[str, Any] = {
            "job_id": job_id,
            "status": self.next_status,
            "text": self.next_text,
        }
        if self.next_sections is not None:
            result["sections"] = self.next_sections
        if self.next_error is not None:
            result["error"] = self.next_error
        return result

    async def health(self) -> dict[str, Any]:
        return {"status": "ok", "wm_ready": True}


# --- fixtures -------------------------------------------------------------


@pytest.fixture()
def fake_backend() -> Iterator[FakePWMBackend]:
    backend = FakePWMBackend()
    serve.set_backend(backend)
    try:
        yield backend
    finally:
        serve.reset_backend()


@pytest.fixture()
def client(
    monkeypatch: pytest.MonkeyPatch,
    fake_backend: FakePWMBackend,
) -> TestClient:
    monkeypatch.setenv("PWM_HMAC_SECRET", TEST_SECRET)
    monkeypatch.setenv("PWM_SKIP_BACKEND_IMPORT", "1")
    return TestClient(serve.app)


# --- HMAC signing helpers (matches HmacAndLogMiddleware payload format) ---


def _sign(body: bytes, ts: str, secret: str = TEST_SECRET) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        body + b"\n" + ts.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()


def _signed_post(
    client: TestClient,
    path: str,
    payload: dict[str, Any],
    *,
    signature_override: str | None = None,
    timestamp_offset_seconds: int = 0,
) -> httpx.Response:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ts = str(int(time.time()) + timestamp_offset_seconds)
    return client.post(
        path,
        content=body,
        headers={
            "content-type": "application/json",
            "x-neofm-timestamp": ts,
            "x-neofm-signature": signature_override or _sign(body, ts),
            "x-neofm-trace-id": "trace-" + ts,
        },
    )


BASE_PAYLOAD: dict[str, Any] = {
    "job_id": "00000000-0000-0000-0000-000000000000",
    "trace_id": "trace-0",
    "language": "kn",
    "style_family": "kannada-folk",
    "prompt": "rain on a quiet evening",
    "music_context": {"raga": "kapi", "tala": "adi", "tempo": "slow"},
    "timeout_seconds": 5.0,
}


# --- 1. /healthz is unauthenticated --------------------------------------


def test_healthz_returns_200_without_hmac_when_backend_ready(
    client: TestClient,
    fake_backend: FakePWMBackend,
) -> None:
    """``/healthz`` must never require HMAC -- the docker healthcheck has
    no way to sign requests. When the backend is loaded, it should
    return 200 with ``pwm_ready: true``."""
    r = client.get("/healthz")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    assert body["pwm_ready"] is True
    assert body["phase"] == serve.PHASE


def test_healthz_returns_503_when_backend_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If PWM never loaded (no volume mount), ``/healthz`` must be
    reachable but report degraded so the operator sees the failure.

    The lifespan runs ``_try_import_pwm_backend`` on TestClient enter,
    which sets ``reason`` to ``PWM_SKIP_BACKEND_IMPORT=1`` in our test
    env. We assert on that exact degraded message rather than a
    fictitious path so the test stays deterministic.
    """
    monkeypatch.setenv("PWM_HMAC_SECRET", TEST_SECRET)
    monkeypatch.setenv("PWM_SKIP_BACKEND_IMPORT", "1")
    serve.reset_backend()
    with TestClient(serve.app) as c:
        r = c.get("/healthz")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "degraded"
    assert body["pwm_ready"] is False
    assert body["reason"] is not None and body["reason"] != ""


# --- 2. /v1/generate-lyric without HMAC is 401 ---------------------------


def test_generate_lyric_without_hmac_is_401(client: TestClient) -> None:
    r = client.post("/v1/generate-lyric", json=BASE_PAYLOAD)
    assert r.status_code == 401
    # Body shape should match the contract (error key present).
    assert "error" in r.json()


def test_generate_lyric_with_stale_timestamp_is_401(client: TestClient) -> None:
    """Replay protection: timestamps older than HMAC_MAX_SKEW_SECONDS are
    rejected even if the signature is otherwise valid."""
    r = _signed_post(client, "/v1/generate-lyric", BASE_PAYLOAD,
                     timestamp_offset_seconds=-3600)
    assert r.status_code == 401


def test_generate_lyric_with_wrong_signature_is_401(client: TestClient) -> None:
    r = _signed_post(client, "/v1/generate-lyric", BASE_PAYLOAD,
                     signature_override="deadbeef" * 8)
    assert r.status_code == 401


# --- 3. happy path: valid HMAC + mock PWM returns 200 --------------------


def test_generate_lyric_happy_path(
    client: TestClient,
    fake_backend: FakePWMBackend,
) -> None:
    """End-to-end: HMAC verifies, the wrapper translates the request,
    calls the (fake) PWM backend, polls until complete, parses sections,
    and returns a LyricResponse."""
    r = _signed_post(client, "/v1/generate-lyric", BASE_PAYLOAD)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["job_id"] == BASE_PAYLOAD["job_id"]
    assert body["status"] == "complete"
    assert "First opening line" in body["text"]
    # Music context passes straight through.
    assert body["music_context"]["raga"] == "kapi"

    # Sections parsed from the [Header] format the fake backend emitted.
    section_types = [s["type"] for s in body["sections"]]
    assert "pallavi" in section_types
    assert "anupallavi" in section_types
    pallavi = next(s for s in body["sections"] if s["type"] == "pallavi")
    assert "First opening line" in pallavi["text"]
    assert "Second opening line" in pallavi["text"]
    # Music context propagated to each section so downstream consumers
    # (mixer / co-composer) get the per-section harmony state.
    assert pallavi["music_context"]["raga"] == "kapi"

    # The wrapper translated style_family + language correctly before
    # invoking PWM.
    assert fake_backend.last_request is not None
    assert fake_backend.last_request.domain == "kannada_film"
    assert fake_backend.last_request.language == "kannada"
    assert fake_backend.last_request.theme == BASE_PAYLOAD["prompt"]
    assert fake_backend.last_request.music_context == BASE_PAYLOAD["music_context"]


def test_generate_lyric_503_when_backend_unloaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the PWM backend never loaded, the endpoint must report 503
    rather than crashing on a None reference."""
    monkeypatch.setenv("PWM_HMAC_SECRET", TEST_SECRET)
    monkeypatch.setenv("PWM_SKIP_BACKEND_IMPORT", "1")
    serve.reset_backend()
    with TestClient(serve.app) as c:
        body = json.dumps(BASE_PAYLOAD, separators=(",", ":")).encode("utf-8")
        ts = str(int(time.time()))
        r = c.post(
            "/v1/generate-lyric",
            content=body,
            headers={
                "content-type": "application/json",
                "x-neofm-timestamp": ts,
                "x-neofm-signature": _sign(body, ts),
            },
        )
    assert r.status_code == 503
    assert r.json()["detail"]["error"] == "pwm_backend_not_loaded"


# --- 4. domain mapping covers every StyleFamily --------------------------


def test_style_to_domain_covers_all_style_families() -> None:
    """Every neo-fm StyleFamily Literal must map to a PWM domain.

    Source of truth: ``LyricRequest.style_family`` Literal in serve.py.
    If a new style is added on the neo-fm side, this test forces the
    operator to update STYLE_TO_DOMAIN.
    """
    # Pull the Literal members straight out of the Pydantic schema so we
    # don't duplicate the list (and immediately get out of sync).
    schema = serve.LyricRequest.model_json_schema()
    style_field = schema["properties"]["style_family"]
    literal_values: list[str] = style_field["enum"]
    assert len(literal_values) == 10, (
        f"Expected 10 style families, got {len(literal_values)}: {literal_values}"
    )
    missing = [s for s in literal_values if s not in serve.STYLE_TO_DOMAIN]
    assert missing == [], f"STYLE_TO_DOMAIN missing entries for: {missing}"
    # And every mapped domain is a non-empty string.
    for style, domain in serve.STYLE_TO_DOMAIN.items():
        assert isinstance(domain, str) and domain, (
            f"STYLE_TO_DOMAIN[{style!r}] must be a non-empty string"
        )
