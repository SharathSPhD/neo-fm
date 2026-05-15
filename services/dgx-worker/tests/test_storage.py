"""Unit tests for the Supabase Storage client.

The single substantive assertion here is that every upload carries
**both** ``apikey`` and ``Authorization`` headers. Phase 4 bring-up
caught a regression where sending only ``Authorization: Bearer
sb_secret_...`` made the Supabase gateway try to parse the bearer as a
Compact JWS and reject the request with ``400 "Invalid Compact JWS"``.
The fix is to send both headers; this test locks it in.
"""

from __future__ import annotations

import httpx
import pytest

from app.storage import StorageClient


@pytest.mark.asyncio
async def test_put_object_sends_apikey_and_authorization_headers() -> None:
    """Both `apikey` and `Authorization: Bearer <key>` must be present.

    Supabase's new opaque `sb_secret_*` / `sb_publishable_*` API keys are
    not JWTs; the gateway tries to parse the bearer as a Compact JWS and
    400s when only `Authorization` is sent. Both headers required for
    Storage uploads to work against the live project.
    """
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(dict(request.headers))
        return httpx.Response(200, json={"Key": "tracks/x/y.wav"})

    client = StorageClient(
        supabase_url="https://proj.supabase.co",
        service_role_key="sb_secret_abc",
        bucket="tracks",
        transport=httpx.MockTransport(handler),
    )
    try:
        await client.put_object(
            object_path="job-1/attempt-1.wav",
            content=b"RIFF....",
            content_type="audio/wav",
        )
    finally:
        await client.aclose()

    assert captured.get("apikey") == "sb_secret_abc", (
        "Storage uploads must include the `apikey` header alongside "
        "Authorization so the new opaque sb_secret_* keys are accepted."
    )
    assert captured.get("authorization") == "Bearer sb_secret_abc"
    assert captured.get("content-type") == "audio/wav"
    assert captured.get("x-upsert") == "true"


@pytest.mark.asyncio
async def test_put_object_raises_on_4xx_with_response_body() -> None:
    """Non-2xx responses must raise with the response text included.

    Worker classifies storage failures by message; the surface needs
    enough context to be actionable (Phase 4 bring-up surfaced an
    'Invalid Compact JWS' error that was only legible because we
    re-ran the request manually).
    """

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "Invalid Compact JWS"})

    client = StorageClient(
        supabase_url="https://proj.supabase.co",
        service_role_key="bad-key",
        bucket="tracks",
        transport=httpx.MockTransport(handler),
    )
    try:
        with pytest.raises(RuntimeError) as exc:
            await client.put_object(
                object_path="job/attempt.wav",
                content=b"...",
                content_type="audio/wav",
            )
    finally:
        await client.aclose()

    assert "400" in str(exc.value)
    assert "Invalid Compact JWS" in str(exc.value)


def test_object_path_is_bucket_relative() -> None:
    """`tracks.url` storage convention: `<job_id>/<attempt_id>.<ext>`.

    RLS policy `tracks_storage_select_via_job` reads
    `storage.foldername(name)[1]` as `job_id`, so the path must NOT
    carry a leading bucket prefix or slash.
    """
    client = StorageClient(
        supabase_url="https://proj.supabase.co",
        service_role_key="k",
        bucket="tracks",
    )
    try:
        assert client.object_path("job-1", "attempt-2", "wav") == "job-1/attempt-2.wav"
        assert client.storage_url("job-1/attempt-2.wav") == "tracks/job-1/attempt-2.wav"
    finally:
        # No async I/O happened; close the implicit httpx client.
        import asyncio

        asyncio.run(client.aclose())
