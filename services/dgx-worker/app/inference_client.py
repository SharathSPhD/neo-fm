"""HMAC-authenticated client for the music-inference service.

Implements ADR 0003. The shared secret signs ``body_bytes || "\\n" ||
timestamp_unix_seconds`` with HMAC-SHA256; the request carries

    X-NeoFM-Timestamp: <unix-seconds>
    X-NeoFM-Signature: <hex>
    X-NeoFM-Trace-Id: <trace_id>

The server side (services/music-inference) rejects requests where the
signature does not match or the timestamp is more than 60s skewed.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import httpx


def sign_request_body(body: bytes, timestamp_seconds: int, secret: str) -> str:
    """Return the hex HMAC-SHA256 of ``body || "\\n" || ts_seconds_ascii``.

    Matches the canonical-string format defined in ADR 0003 and implemented
    by ``services/music-inference/app/serve.py::_verify_hmac``.
    """
    payload = body + b"\n" + str(timestamp_seconds).encode("ascii")
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def sha256_hex(body: bytes) -> str:
    """Helper exposed for tests that want to assert payload contents."""
    return hashlib.sha256(body).hexdigest()


class MusicInferenceClient:
    def __init__(
        self,
        base_url: str,
        hmac_secret: str,
        timeout_seconds: float = 600.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._hmac_secret = hmac_secret
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=httpx.Timeout(timeout_seconds, connect=10.0),
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def generate(
        self,
        *,
        request_body: dict[str, Any],
        trace_id: str,
    ) -> bytes:
        """POST /v1/generate; return the WAV bytes the service produced."""
        body = json.dumps(request_body, separators=(",", ":")).encode()
        # Unix seconds, matching the server-side skew check (ADR 0003).
        ts = int(time.time())
        signature = sign_request_body(body, ts, self._hmac_secret)
        headers = {
            "content-type": "application/json",
            "x-neofm-timestamp": str(ts),
            "x-neofm-signature": signature,
            "x-neofm-trace-id": trace_id,
        }
        response = await self._client.post(
            "/v1/generate",
            content=body,
            headers=headers,
        )
        response.raise_for_status()
        return response.content
