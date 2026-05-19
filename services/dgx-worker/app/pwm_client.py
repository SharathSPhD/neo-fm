"""HMAC-authenticated client for the Pratyabhijna World Model API service.

Calls the neo-fm-shaped endpoint  POST /v1/generate-lyric  on the
``pwm-api`` sidecar service (services/pwm-api/).  That endpoint blocks
until PWM generation is complete and returns structured sections — no
polling required on the worker side.

HMAC signing follows ADR 0003 (same scheme as inference_client.py).
When ``base_url`` is empty the client is considered disabled; callers
receive None without any network activity.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx

from .inference_client import sign_request_body
from .models import SongDocument, SongDocumentSection

LOG = logging.getLogger("neo_fm.dgx_worker.pwm")


class PWMClient:
    """Async HMAC client wrapping POST /v1/generate-lyric."""

    def __init__(
        self,
        base_url: str,
        hmac_secret: str,
        timeout_seconds: float = 120.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._hmac_secret = hmac_secret
        # Pass the full timeout as the HTTP timeout AND as timeout_seconds
        # inside the request body so the pwm-api knows how long to wait.
        self._lyric_timeout = timeout_seconds
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=httpx.Timeout(timeout_seconds + 10.0, connect=10.0),
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    def _signed_headers(self, body: bytes, trace_id: str) -> dict[str, str]:
        ts = int(time.time())
        sig = sign_request_body(body, ts, self._hmac_secret)
        return {
            "content-type": "application/json",
            "x-neofm-timestamp": str(ts),
            "x-neofm-signature": sig,
            "x-neofm-trace-id": trace_id,
        }

    async def generate_lyrics(
        self,
        *,
        job_id: str,
        style_family: str,
        language: str,
        prompt: str,
        music_context: dict[str, Any] | None = None,
        trace_id: str,
    ) -> list[dict[str, Any]] | None:
        """Request lyric generation; return parsed sections or None on failure.

        Returns a list of dicts with keys ``type`` (str) and ``text`` (str),
        matching the LyricSection schema from services/pwm-api/serve.py.
        Returns None on any HTTP / timeout / parsing error so the caller can
        proceed with empty lyrics rather than failing the job.
        """
        payload: dict[str, Any] = {
            "job_id": job_id,
            "trace_id": trace_id,
            "language": language,
            "style_family": style_family,
            "prompt": prompt,
            "music_context": music_context or {},
            "timeout_seconds": self._lyric_timeout,
        }
        body = json.dumps(payload, separators=(",", ":")).encode()

        try:
            resp = await self._client.post(
                "/v1/generate-lyric",
                content=body,
                headers=self._signed_headers(body, trace_id),
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            LOG.warning(
                "pwm_generate_lyric_failed",
                extra={"err": str(exc), "trace_id": trace_id},
            )
            return None

        if data.get("status") != "complete":
            LOG.warning(
                "pwm_generate_lyric_non_complete",
                extra={
                    "status": data.get("status"),
                    "error": data.get("error"),
                    "trace_id": trace_id,
                },
            )
            return None

        sections = data.get("sections")
        return sections if isinstance(sections, list) else None


def fill_section_lyrics(
    sections: list[SongDocumentSection],
    lyric_sections: list[dict[str, Any]],
) -> list[SongDocumentSection]:
    """Merge PWM-generated lyric sections into the document sections.

    Matching strategy (in order):
    1. If a lyric_section type matches a document section type exactly, assign it.
    2. After typed matching, assign remaining lyric_sections in index order to
       document sections that still have no lyrics.
    3. Sections that already have lyrics are left unchanged.

    This handles: extra/fewer sections from PWM, mismatched names, and round-trips
    where the co-composer picked the same section types as PWM's domain instructions.
    """
    used: set[int] = set()
    result: list[SongDocumentSection] = list(sections)

    # Pass 1: type-based matching
    for doc_idx, doc_sec in enumerate(result):
        if doc_sec.lyrics is not None:
            continue
        for lyric_idx, lyric in enumerate(lyric_sections):
            if lyric_idx in used:
                continue
            if lyric.get("type") == doc_sec.type:
                lyrics_text = lyric.get("text") or ""
                result[doc_idx] = doc_sec.model_copy(update={"lyrics": lyrics_text})
                used.add(lyric_idx)
                break

    # Pass 2: index-order fallback for still-empty sections
    remaining = [lyr for i, lyr in enumerate(lyric_sections) if i not in used]
    rem_iter = iter(remaining)
    for doc_idx, doc_sec in enumerate(result):
        if doc_sec.lyrics is not None:
            continue
        lyric = next(rem_iter, None)
        if lyric is None:
            break
        result[doc_idx] = doc_sec.model_copy(update={"lyrics": lyric.get("text") or ""})

    return result


async def expand_lyrics_from_pwm(
    song_document: SongDocument,
    pwm: PWMClient,
    *,
    job_id: str,
    trace_id: str,
) -> SongDocument:
    """If the document carries a prompt in metadata, generate lyrics via PWM.

    Short-circuits without mutation when:
    - metadata is absent or has no "prompt" key
    - all sections already have lyrics
    - PWM returns None (unavailable / error)
    """
    if not song_document.metadata:
        return song_document
    prompt = song_document.metadata.get("prompt")
    if not prompt:
        return song_document
    if all(s.lyrics is not None for s in song_document.sections):
        return song_document

    music_ctx: dict[str, Any] = {}
    if song_document.raga and isinstance(song_document.raga, dict):
        raga_name = song_document.raga.get("name")
        if raga_name:
            music_ctx["raga"] = raga_name
    if song_document.tala:
        music_ctx["tala"] = song_document.tala
    if song_document.tempo_bpm:
        music_ctx["tempo"] = song_document.tempo_bpm

    lyric_sections = await pwm.generate_lyrics(
        job_id=job_id,
        style_family=song_document.style_family,
        language=song_document.language,
        prompt=str(prompt),
        music_context=music_ctx or None,
        trace_id=trace_id,
    )
    if not lyric_sections:
        LOG.warning(
            "pwm_lyric_expansion_skipped; continuing with empty lyrics",
            extra={"trace_id": trace_id},
        )
        return song_document

    updated = fill_section_lyrics(song_document.sections, lyric_sections)
    return song_document.model_copy(update={"sections": updated})
