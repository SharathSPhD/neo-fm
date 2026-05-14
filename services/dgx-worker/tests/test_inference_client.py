"""Unit tests for the HMAC inference client.

Includes a contract test against the **actual** verification function the
music-inference server runs, so the worker and the inference service can
never drift on signing.
"""

from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import sys
import time
from pathlib import Path

import httpx
import pytest

from app.inference_client import MusicInferenceClient, sign_request_body


def _server_verify_hmac(body: bytes, signature: str, timestamp: str, secret: str) -> bool:
    """Inline mirror of services/music-inference/app/serve.py::_verify_hmac.

    Copied here intentionally so we capture the server's wire format as a
    cross-service contract in the worker's own test suite, even when
    FastAPI / the inference deps aren't installed. The body of this function
    must stay byte-identical to the server's; both sites cite ADR 0003.
    """
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    if abs(time.time() - ts) > 60:
        return False
    payload = body + b"\n" + timestamp.encode("ascii")
    expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _load_serve_module() -> object | None:
    """Best-effort import of the actual server module, when its deps exist."""
    serve_path = (
        Path(__file__).resolve().parents[3]
        / "music-inference"
        / "app"
        / "serve.py"
    )
    if not serve_path.exists():
        return None
    spec = importlib.util.spec_from_file_location(
        "music_inference_serve",
        serve_path,
    )
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    sys.modules["music_inference_serve"] = module
    try:
        spec.loader.exec_module(module)
    except ModuleNotFoundError:
        return None
    return module


def test_sign_request_body_matches_adr_0003() -> None:
    body = b'{"x":1}'
    ts = 1715000000
    secret = "topsecret"
    expected = hmac.new(
        secret.encode(),
        body + b"\n" + str(ts).encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    assert sign_request_body(body, ts, secret) == expected


def test_signature_verifies_against_inline_server_logic() -> None:
    """Worker sign + server verify must agree on canonical-string format
    and timestamp units. Uses an inline mirror of the server's
    `_verify_hmac` so the contract is asserted even when FastAPI is not
    installed in this venv."""
    secret = "shared-secret"
    body = json.dumps({"job_id": "abc", "style_family": "carnatic"}).encode()
    ts = int(time.time())
    sig = sign_request_body(body, ts, secret)
    assert _server_verify_hmac(body, sig, str(ts), secret) is True


def test_signature_verifies_against_real_server_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Belt-and-suspenders: when the real services/music-inference module
    is importable, run the worker signature through the actual
    `_verify_hmac` the server runs in production. Skips silently if the
    inference service deps aren't installed in this venv."""
    serve = _load_serve_module()
    if serve is None:
        pytest.skip("services/music-inference deps not installed in worker venv")

    secret = "shared-secret"
    monkeypatch.setenv("MUSIC_INFERENCE_HMAC_SECRET", secret)
    body = json.dumps({"job_id": "abc", "style_family": "carnatic"}).encode()
    ts = int(time.time())
    sig = sign_request_body(body, ts, secret)
    assert serve._verify_hmac(body, sig, str(ts)) is True  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_generate_signs_request_and_returns_bytes() -> None:
    captured_url: str = ""
    captured_body: bytes = b""
    captured_headers: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_url, captured_body, captured_headers
        captured_url = str(request.url)
        captured_body = request.content
        captured_headers = dict(request.headers)
        return httpx.Response(200, content=b"WAV")

    transport = httpx.MockTransport(handler)
    client = MusicInferenceClient(
        base_url="https://inference.test",
        hmac_secret="s3cret",
        timeout_seconds=5,
        transport=transport,
    )
    try:
        out = await client.generate(
            request_body={"job_id": "abc"},
            trace_id="trace-1",
        )
    finally:
        await client.aclose()

    assert out == b"WAV"
    assert captured_url == "https://inference.test/v1/generate"
    assert captured_headers["content-type"] == "application/json"
    assert captured_headers["x-neofm-trace-id"] == "trace-1"

    ts = int(captured_headers["x-neofm-timestamp"])
    # ts must be unix-seconds, not ms — sanity check the magnitude.
    assert 1_000_000_000 <= ts <= 99_999_999_999, (
        "x-neofm-timestamp must be unix-seconds per ADR 0003"
    )
    expected = sign_request_body(captured_body, ts, "s3cret")
    assert captured_headers["x-neofm-signature"] == expected

    # Body is compact JSON (no whitespace) so the server-side digest matches.
    assert captured_body == json.dumps({"job_id": "abc"}, separators=(",", ":")).encode()


@pytest.mark.asyncio
async def test_generate_propagates_http_errors() -> None:
    transport = httpx.MockTransport(lambda _: httpx.Response(500, text="boom"))
    client = MusicInferenceClient(
        base_url="https://inference.test",
        hmac_secret="s",
        transport=transport,
    )
    try:
        with pytest.raises(httpx.HTTPStatusError) as exc:
            await client.generate(request_body={}, trace_id="t")
        assert exc.value.response.status_code == 500
    finally:
        await client.aclose()
