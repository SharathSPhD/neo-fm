"""HMAC-authenticated client for the lyric-gen IndicBART service.

Calls POST /v1/generate-lyric on the ``lyric-gen`` sidecar.  That endpoint
is synchronous (blocks until all sections are generated) and returns per-
section lyrics with syllable counts.

Typical use: fill in any SongDocumentSection that still has no lyrics after
the PWM expansion step.  Indic scripts only — sections in English ("en")
are skipped because IndicBART is not trained on English.

HMAC signing follows ADR 0003 (same scheme as inference_client.py).
When ``base_url`` is empty the client is disabled; None is returned.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx

from .inference_client import sign_request_body
from .models import SongDocument, SongDocumentSection

LOG = logging.getLogger("neo_fm.dgx_worker.lyric_gen")

# IndicBART covers these language codes.  English is deliberately excluded.
_INDIC_LANGUAGES: frozenset[str] = frozenset({"hi", "kn", "ta", "te", "bn", "sa"})

# Rough syllable-density assumption: 4 syllables / second.
# Used to convert target_seconds → target_syllables when none is provided.
_SYLLABLES_PER_SECOND = 4


def _syllables_for_section(section: SongDocumentSection) -> int:
    return max(1, section.target_seconds * _SYLLABLES_PER_SECOND)


class LyricGenClient:
    """Async HMAC client wrapping POST /v1/generate-lyric on lyric-gen."""

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

    def _signed_headers(self, body: bytes, trace_id: str) -> dict[str, str]:
        ts = int(time.time())
        sig = sign_request_body(body, ts, self._hmac_secret)
        return {
            "content-type": "application/json",
            "x-neofm-timestamp": str(ts),
            "x-neofm-signature": sig,
            "x-neofm-trace-id": trace_id,
        }

    async def fill_missing_lyrics(
        self,
        *,
        job_id: str,
        language: str,
        style_family: str,
        sections: list[SongDocumentSection],
        prompt: str = "",
        raga_name: str | None = None,
        trace_id: str,
    ) -> dict[str, str] | None:
        """Generate lyrics for sections that have no lyrics.

        Returns a dict mapping section_id → lyrics string for the sections
        that were generated.  Returns None if the service is unavailable.
        Sections that already have lyrics are excluded from the request.
        """
        empty_sections = [s for s in sections if s.lyrics is None]
        if not empty_sections:
            return {}

        payload: dict[str, Any] = {
            "job_id": job_id,
            "trace_id": trace_id,
            "language": language,
            "style_family": style_family,
            "prompt": prompt or "a song",
            "sections": [
                {
                    "section_id": s.id,
                    "section_type": s.type,
                    "target_syllables": _syllables_for_section(s),
                }
                for s in empty_sections
            ],
        }
        if raga_name:
            payload["raga_name"] = raga_name

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
                "lyric_gen_request_failed",
                extra={"err": str(exc), "trace_id": trace_id},
            )
            return None

        return {
            s["section_id"]: s.get("lyrics", "")
            for s in data.get("sections", [])
            if s.get("lyrics")
        }


async def fill_lyrics_with_indicbart(
    song_document: SongDocument,
    lyric_gen: LyricGenClient,
    *,
    job_id: str,
    trace_id: str,
) -> SongDocument:
    """Fill any still-empty sections using lyric-gen (IndicBART).

    Short-circuits when:
    - all sections already have lyrics
    - language is English (not supported by IndicBART)
    - lyric-gen returns None (unavailable)
    """
    if song_document.language not in _INDIC_LANGUAGES:
        return song_document
    if all(s.lyrics is not None for s in song_document.sections):
        return song_document

    raga_name: str | None = None
    if song_document.raga and isinstance(song_document.raga, dict):
        raw_raga_name = song_document.raga.get("name")
        raga_name = str(raw_raga_name) if raw_raga_name is not None else None

    prompt = ""
    if song_document.metadata and isinstance(song_document.metadata, dict):
        prompt = str(song_document.metadata.get("prompt") or "")

    result = await lyric_gen.fill_missing_lyrics(
        job_id=job_id,
        language=song_document.language,
        style_family=song_document.style_family,
        sections=song_document.sections,
        prompt=prompt,
        raga_name=raga_name,
        trace_id=trace_id,
    )
    if not result:
        LOG.warning(
            "lyric_gen_skipped; no lyrics generated",
            extra={"trace_id": trace_id},
        )
        return song_document

    updated: list[SongDocumentSection] = [
        s.model_copy(update={"lyrics": result[s.id]}) if s.lyrics is None and s.id in result else s
        for s in song_document.sections
    ]
    return song_document.model_copy(update={"sections": updated})
