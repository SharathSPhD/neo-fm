"""Unit tests for PWM lyric expansion (v1.5 Sprint 1).

Tests cover:
  - fill_section_lyrics: type-based matching, index fallback, round-trip
  - PWMClient: HMAC signing, happy-path, HTTP errors, non-complete status
  - expand_lyrics_from_pwm: short-circuit cases, end-to-end mutation
"""

from __future__ import annotations

import hashlib
import hmac
import time
import uuid
from typing import Any

import httpx
import pytest

from app.models import SongDocument, SongDocumentSection
from app.pwm_client import (
    PWMClient,
    expand_lyrics_from_pwm,
    fill_section_lyrics,
)

# ─── Helpers ─────────────────────────────────────────────────────────────────


def _make_section(
    section_type: str,
    lyrics: str | None = None,
    idx: int = 0,
) -> SongDocumentSection:
    return SongDocumentSection(
        id=f"s{idx + 1}",
        type=section_type,
        target_seconds=30,
        lyrics=lyrics,
    )


def _make_song_doc(
    sections: list[SongDocumentSection],
    metadata: dict[str, Any] | None = None,
    style_family: str = "western",
    language: str = "en",
) -> SongDocument:
    return SongDocument.model_validate({
        "language": language,
        "style_family": style_family,
        "target_duration_seconds": 90,
        "sections": [s.model_dump() for s in sections],
        "metadata": metadata,
    })


def _fake_lyric_response(
    sections: list[dict[str, Any]], status: str = "complete"
) -> dict[str, Any]:
    return {
        "job_id": str(uuid.uuid4()),
        "status": status,
        "text": "\n\n".join(s.get("text", "") for s in sections),
        "sections": sections,
        "music_context": {},
        "error": None,
    }


# ─── fill_section_lyrics ─────────────────────────────────────────────────────


class TestFillSectionLyrics:
    def test_type_based_match(self) -> None:
        doc_sections = [
            _make_section("verse", idx=0),
            _make_section("chorus", idx=1),
        ]
        lyric_sections = [
            {"type": "chorus", "text": "chorus text", "music_context": {}},
            {"type": "verse", "text": "verse text", "music_context": {}},
        ]
        result = fill_section_lyrics(doc_sections, lyric_sections)
        assert result[0].lyrics == "verse text"
        assert result[1].lyrics == "chorus text"

    def test_index_fallback_when_types_differ(self) -> None:
        doc_sections = [_make_section("pallavi", idx=0), _make_section("charanam", idx=1)]
        lyric_sections = [
            {"type": "intro", "text": "opening", "music_context": {}},
            {"type": "bridge", "text": "middle", "music_context": {}},
        ]
        result = fill_section_lyrics(doc_sections, lyric_sections)
        # Neither type matched → index fallback
        assert result[0].lyrics == "opening"
        assert result[1].lyrics == "middle"

    def test_already_has_lyrics_unchanged(self) -> None:
        doc_sections = [
            _make_section("verse", lyrics="existing", idx=0),
            _make_section("chorus", idx=1),
        ]
        lyric_sections = [
            {"type": "verse", "text": "new verse", "music_context": {}},
            {"type": "chorus", "text": "chorus text", "music_context": {}},
        ]
        result = fill_section_lyrics(doc_sections, lyric_sections)
        assert result[0].lyrics == "existing"  # untouched
        assert result[1].lyrics == "chorus text"

    def test_fewer_lyric_sections_than_doc(self) -> None:
        doc_sections = [
            _make_section("verse", idx=0),
            _make_section("chorus", idx=1),
            _make_section("outro", idx=2),
        ]
        lyric_sections = [{"type": "verse", "text": "only one stanza", "music_context": {}}]
        result = fill_section_lyrics(doc_sections, lyric_sections)
        assert result[0].lyrics == "only one stanza"
        assert result[1].lyrics is None  # not enough stanzas
        assert result[2].lyrics is None

    def test_more_lyric_sections_than_doc(self) -> None:
        doc_sections = [_make_section("verse", idx=0)]
        lyric_sections = [
            {"type": "verse", "text": "first", "music_context": {}},
            {"type": "chorus", "text": "second", "music_context": {}},
        ]
        result = fill_section_lyrics(doc_sections, lyric_sections)
        assert len(result) == 1
        assert result[0].lyrics == "first"

    def test_empty_lyric_sections(self) -> None:
        doc_sections = [_make_section("verse", idx=0)]
        result = fill_section_lyrics(doc_sections, [])
        assert result[0].lyrics is None


# ─── PWMClient ───────────────────────────────────────────────────────────────


class TestPWMClientHmac:
    """Verify that the client signs requests with the correct HMAC scheme."""

    def _server_verify(
        self,
        body: bytes,
        signature: str,
        timestamp: str,
        secret: str,
    ) -> bool:
        try:
            ts = int(timestamp)
        except (TypeError, ValueError):
            return False
        if abs(time.time() - ts) > 60:
            return False
        payload = body + b"\n" + timestamp.encode("ascii")
        expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def test_signed_headers_are_valid(self) -> None:
        client = PWMClient(
            base_url="http://pwm-api:9000",
            hmac_secret="test-secret",
            transport=httpx.MockTransport(lambda _r: httpx.Response(200, json={})),
        )
        body = b'{"hello":"world"}'
        headers = client._signed_headers(body, "trace-123")
        assert self._server_verify(
            body,
            headers["x-neofm-signature"],
            headers["x-neofm-timestamp"],
            "test-secret",
        )


class TestPWMClientGenerateLyrics:
    """Integration-style tests using httpx.MockTransport."""

    def _transport(self, response: dict[str, Any], status_code: int = 200) -> httpx.MockTransport:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(status_code, json=response)
        return httpx.MockTransport(handler)

    @pytest.mark.asyncio
    async def test_happy_path_returns_sections(self) -> None:
        lyric_resp = _fake_lyric_response([
            {"type": "verse", "text": "verse lyrics", "music_context": {}},
            {"type": "chorus", "text": "chorus lyrics", "music_context": {}},
        ])
        client = PWMClient(
            base_url="http://pwm-api:9000",
            hmac_secret="s3cr3t",
            transport=self._transport(lyric_resp),
        )
        result = await client.generate_lyrics(
            job_id=str(uuid.uuid4()),
            style_family="western",
            language="en",
            prompt="a rainy evening in the city",
            trace_id="trace-xyz",
        )
        assert result is not None
        assert len(result) == 2
        assert result[0]["type"] == "verse"
        await client.aclose()

    @pytest.mark.asyncio
    async def test_http_error_returns_none(self) -> None:
        client = PWMClient(
            base_url="http://pwm-api:9000",
            hmac_secret="s3cr3t",
            transport=self._transport({}, status_code=503),
        )
        result = await client.generate_lyrics(
            job_id=str(uuid.uuid4()),
            style_family="carnatic",
            language="kn",
            prompt="raga bhairavi",
            trace_id="trace-abc",
        )
        assert result is None
        await client.aclose()

    @pytest.mark.asyncio
    async def test_non_complete_status_returns_none(self) -> None:
        lyric_resp = _fake_lyric_response([], status="error")
        lyric_resp["error"] = "pwm backend not loaded"
        client = PWMClient(
            base_url="http://pwm-api:9000",
            hmac_secret="s3cr3t",
            transport=self._transport(lyric_resp),
        )
        result = await client.generate_lyrics(
            job_id=str(uuid.uuid4()),
            style_family="hindustani",
            language="hi",
            prompt="raag yaman",
            trace_id="trace-err",
        )
        assert result is None
        await client.aclose()

    @pytest.mark.asyncio
    async def test_sections_field_missing_returns_none(self) -> None:
        client = PWMClient(
            base_url="http://pwm-api:9000",
            hmac_secret="s3cr3t",
            transport=self._transport({"job_id": "x", "status": "complete", "text": "some text"}),
        )
        result = await client.generate_lyrics(
            job_id=str(uuid.uuid4()),
            style_family="bollywood-ballad",
            language="hi",
            prompt="love in the monsoon",
            trace_id="trace-nosec",
        )
        assert result is None
        await client.aclose()


# ─── expand_lyrics_from_pwm ──────────────────────────────────────────────────


class FakePWMClient:
    """Minimal async-compatible fake for expand_lyrics_from_pwm tests."""

    def __init__(self, return_value: list[dict[str, Any]] | None) -> None:
        self._return_value = return_value
        self.call_count = 0
        self.last_kwargs: dict[str, Any] = {}

    async def generate_lyrics(self, **kwargs: Any) -> list[dict[str, Any]] | None:
        self.call_count += 1
        self.last_kwargs = kwargs
        return self._return_value

    def assert_not_called(self) -> None:
        assert self.call_count == 0, f"Expected not called but was called {self.call_count} times"


class TestExpandLyricsFromPwm:
    def _pwm(self, lyric_sections: list[dict[str, Any]] | None) -> FakePWMClient:
        return FakePWMClient(lyric_sections)

    @pytest.mark.asyncio
    async def test_no_metadata_returns_unchanged(self) -> None:
        doc = _make_song_doc([_make_section("verse")], metadata=None)
        pwm = self._pwm([{"type": "verse", "text": "lyrics"}])
        result = await expand_lyrics_from_pwm(doc, pwm, job_id="j1", trace_id="t1")  # type: ignore[arg-type]
        assert result is doc  # same object, no copy
        pwm.assert_not_called()

    @pytest.mark.asyncio
    async def test_metadata_without_prompt_returns_unchanged(self) -> None:
        doc = _make_song_doc([_make_section("verse")], metadata={"source": "upload"})
        pwm = self._pwm([])
        result = await expand_lyrics_from_pwm(doc, pwm, job_id="j2", trace_id="t2")  # type: ignore[arg-type]
        assert result is doc
        pwm.assert_not_called()

    @pytest.mark.asyncio
    async def test_all_sections_have_lyrics_skips_pwm(self) -> None:
        doc = _make_song_doc(
            [_make_section("verse", lyrics="already set")],
            metadata={"prompt": "some prompt"},
        )
        pwm = self._pwm([])
        result = await expand_lyrics_from_pwm(doc, pwm, job_id="j3", trace_id="t3")  # type: ignore[arg-type]
        assert result is doc
        pwm.assert_not_called()

    @pytest.mark.asyncio
    async def test_pwm_returns_none_returns_original(self) -> None:
        doc = _make_song_doc(
            [_make_section("verse")],
            metadata={"prompt": "rainy evening"},
        )
        pwm = self._pwm(None)
        result = await expand_lyrics_from_pwm(doc, pwm, job_id="j4", trace_id="t4")  # type: ignore[arg-type]
        assert result is doc  # unchanged when PWM unavailable

    @pytest.mark.asyncio
    async def test_fills_section_lyrics_from_pwm(self) -> None:
        sections = [_make_section("verse", idx=0), _make_section("chorus", idx=1)]
        doc = _make_song_doc(sections, metadata={"prompt": "city lights"})
        lyric_sections = [
            {"type": "verse", "text": "verse words", "music_context": {}},
            {"type": "chorus", "text": "chorus words", "music_context": {}},
        ]
        pwm = self._pwm(lyric_sections)
        result = await expand_lyrics_from_pwm(doc, pwm, job_id="j5", trace_id="t5")  # type: ignore[arg-type]
        assert result is not doc
        assert result.sections[0].lyrics == "verse words"
        assert result.sections[1].lyrics == "chorus words"

    @pytest.mark.asyncio
    async def test_music_context_forwarded_from_doc(self) -> None:
        sections = [_make_section("pallavi")]
        doc = SongDocument.model_validate({
            "language": "kn",
            "style_family": "carnatic",
            "target_duration_seconds": 60,
            "sections": [s.model_dump() for s in sections],
            "raga": {"name": "Yaman"},
            "tala": "Adi",
            "tempo_bpm": 80,
            "metadata": {"prompt": "bhakti raga"},
        })
        pwm = self._pwm([{"type": "pallavi", "text": "pallavi text", "music_context": {}}])
        await expand_lyrics_from_pwm(doc, pwm, job_id="j6", trace_id="t6")  # type: ignore[arg-type]
        assert pwm.last_kwargs["music_context"]["raga"] == "Yaman"
        assert pwm.last_kwargs["music_context"]["tala"] == "Adi"
        assert pwm.last_kwargs["music_context"]["tempo"] == 80
