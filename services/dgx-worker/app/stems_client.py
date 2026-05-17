"""HMAC-authenticated client for the stems-synth service (v1.4 Sprint 11).

Mirrors `VocalSynthClient` / `MusicInferenceClient`. The worker calls
`generate_stem` once per scheduled section transition; the response
is a 16-bit / 44.1 kHz WAV which the mixer layers on the base mix
with an equal-power crossfade (see `app/mixer.py:StemInsert`).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import httpx


def _sign(body: bytes, ts: int, secret: str) -> str:
    payload = body + b"\n" + str(ts).encode("ascii")
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


class StemsSynthClient:
    """`generate_stem` returns raw WAV bytes; the worker hands them to
    the mixer wrapped in a `StemInsert`.
    """

    def __init__(
        self,
        base_url: str,
        hmac_secret: str,
        timeout_seconds: float = 60.0,
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

    async def generate_stem(
        self,
        *,
        request_body: dict[str, Any],
        trace_id: str,
    ) -> bytes:
        body = json.dumps(request_body, separators=(",", ":")).encode()
        ts = int(time.time())
        sig = _sign(body, ts, self._hmac_secret)
        headers = {
            "content-type": "application/json",
            "x-neofm-timestamp": str(ts),
            "x-neofm-signature": sig,
            "x-neofm-trace-id": trace_id,
        }
        response = await self._client.post(
            "/v1/generate-stem", content=body, headers=headers
        )
        response.raise_for_status()
        return response.content
