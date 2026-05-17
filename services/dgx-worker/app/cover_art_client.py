"""HMAC-authenticated client for the cover-art-synth service.

Mirrors `VocalSynthClient` (ADR 0003 signature shape). Used by the
dgx-worker's cover-art consumer to render one PNG per attempt.
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


class CoverArtSynthClient:
    def __init__(
        self,
        base_url: str,
        hmac_secret: str,
        timeout_seconds: float = 180.0,
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

    async def generate_cover(
        self,
        *,
        request_body: dict[str, Any],
        trace_id: str,
    ) -> tuple[bytes, str | None, str | None]:
        """POST /v1/generate-cover; return (png_bytes, model_version, backend).

        The two metadata values come from response headers the sidecar
        sets (`X-NeoFM-Model-Version`, `X-NeoFM-Backend`). They're
        propagated into `public.cover_art.model_version` and the audit
        row so future debugging can correlate by backend.
        """
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
            "/v1/generate-cover",
            content=body,
            headers=headers,
        )
        response.raise_for_status()
        return (
            response.content,
            response.headers.get("X-NeoFM-Model-Version"),
            response.headers.get("X-NeoFM-Backend"),
        )
