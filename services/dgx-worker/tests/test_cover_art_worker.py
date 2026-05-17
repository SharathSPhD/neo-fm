"""Unit tests for the cover-art consumer (v1.3 Sprint 3)."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.cover_art_worker import (
    CoverArtOutcome,
    cover_art_consumer_loop,
    process_one_cover_art,
)

from .fakes import FakeCoverArtSynthClient, FakeStorageClient, FakeWorkerDB

JOB_ID = "11111111-1111-1111-1111-111111111111"
USER_ID = "22222222-2222-2222-2222-222222222222"
ATTEMPT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


def _settings() -> Settings:
    return Settings(
        pg_dsn="postgres://test",
        supabase_url="https://test.supabase.co",
        supabase_service_role_key="test-key",
        storage_bucket="tracks",
        music_inference_url="http://inference",
        music_inference_hmac_secret="secret",
        music_inference_timeout_seconds=60.0,
        vocal_synth_url="",
        vocal_synth_hmac_secret="",
        vocal_synth_timeout_seconds=60.0,
        vocal_languages=(),
        vocal_voice_timbre="androgynous",
        queue_name="song_generation_jobs",
        dlq_name="song_generation_jobs_dlq",
        visibility_timeout_seconds=300,
        heartbeat_interval_seconds=60,
        poll_interval_seconds=1.0,
        max_attempts=3,
        governor_state_path=__import__("pathlib").Path("/tmp/governor.state"),
        governor_poll_seconds=2.0,
        metrics_port=0,
        cover_art_synth_url="http://cover-art-synth",
        cover_art_synth_hmac_secret="ca-secret",
        cover_art_synth_timeout_seconds=60.0,
        cover_art_bucket="cover-art",
        cover_art_queue_name="cover_art_jobs",
        cover_art_dlq_name="cover_art_jobs_dlq",
        cover_art_visibility_seconds=120,
        cover_art_max_attempts=3,
        cover_art_poll_interval_seconds=0.05,
    )


def _msg(
    payload: dict[str, Any], *, msg_id: int = 1, read_ct: int = 1
) -> dict[str, Any]:
    return {"msg_id": msg_id, "message": payload, "read_ct": read_ct}


def _payload(
    *,
    job_id: str = JOB_ID,
    attempt_id: str = ATTEMPT_A,
    user_id: str = USER_ID,
    prompt: str = "Album cover art for a Carnatic morning",
    style_family: str | None = "carnatic",
) -> dict[str, Any]:
    return {
        "job_id": job_id,
        "attempt_id": attempt_id,
        "trace_id": "trace-1",
        "user_id": user_id,
        "prompt": prompt,
        "style_family": style_family,
    }


@pytest.mark.asyncio
async def test_happy_path_uploads_and_flips_current() -> None:
    db = FakeWorkerDB()
    db.insert_cover_art_attempt(
        job_id=JOB_ID, attempt_id=ATTEMPT_A, prompt="x", trace_id="trace-1",
    )
    db.enqueue(_payload())
    storage = FakeStorageClient(bucket="cover-art")
    synth = FakeCoverArtSynthClient()
    msg = db.read_one(None, "cover_art_jobs", 120)
    assert msg is not None

    outcome = await process_one_cover_art(
        settings=_settings(),
        db=db,
        storage=storage,
        synth=synth,
        queue_msg=msg,
    )

    assert outcome == CoverArtOutcome.COMPLETED
    assert len(synth.calls) == 1
    assert synth.calls[0]["request"]["prompt"].startswith("Album cover art")
    # Upload was attempted with PNG content-type and the expected path.
    assert len(storage.uploads) == 1
    object_path, _bytes, content_type = storage.uploads[0]
    assert object_path == f"{USER_ID}/{JOB_ID}/{ATTEMPT_A}.png"
    assert content_type == "image/png"
    # Attempt row is marked completed with storage_path + model_version.
    row = db.cover_art_attempts[(JOB_ID, ATTEMPT_A)]
    assert row["status"] == "completed"
    assert row["storage_path"] == object_path
    assert row["model_version"] == "fake-cover-art-0.1.0"
    # cover_art row added; is_current=true.
    assert len(db.cover_art_rows) == 1
    art = db.cover_art_rows[0]
    assert art["is_current"] is True
    assert art["url"] == f"cover-art/{object_path}"
    # pgmq message archived.
    assert db.queue[0].archived is True


@pytest.mark.asyncio
async def test_subsequent_attempt_flips_previous_current_to_false() -> None:
    db = FakeWorkerDB()
    # Seed a prior "current" artefact.
    db.cover_art_rows.append(
        {
            "job_id": JOB_ID,
            "url": "cover-art/old/path.png",
            "prompt": "old",
            "model_version": "old-model",
            "is_current": True,
        },
    )
    second_attempt = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    db.insert_cover_art_attempt(
        job_id=JOB_ID, attempt_id=second_attempt, prompt="x", trace_id="trace-2",
    )
    db.enqueue(_payload(attempt_id=second_attempt))
    storage = FakeStorageClient(bucket="cover-art")
    synth = FakeCoverArtSynthClient()
    msg = db.read_one(None, "cover_art_jobs", 120)
    assert msg is not None

    outcome = await process_one_cover_art(
        settings=_settings(), db=db, storage=storage, synth=synth, queue_msg=msg,
    )

    assert outcome == CoverArtOutcome.COMPLETED
    currents = [r for r in db.cover_art_rows if r["is_current"]]
    assert len(currents) == 1
    assert currents[0]["url"].endswith(f"{second_attempt}.png")


@pytest.mark.asyncio
async def test_invalid_payload_goes_straight_to_dlq() -> None:
    db = FakeWorkerDB()
    # Missing `prompt` key — invalid payload.
    bad = {"job_id": JOB_ID, "attempt_id": ATTEMPT_A, "user_id": USER_ID}
    db.enqueue(bad)
    msg = db.read_one(None, "cover_art_jobs", 120)
    assert msg is not None

    outcome = await process_one_cover_art(
        settings=_settings(),
        db=db,
        storage=FakeStorageClient(),
        synth=FakeCoverArtSynthClient(),
        queue_msg=msg,
    )
    assert outcome == CoverArtOutcome.FAILED_DLQ
    assert len(db.dlq) == 1
    assert db.dlq[0]["reason"] == "invalid_payload"
    assert db.queue[0].deleted is True


@pytest.mark.asyncio
async def test_synth_http_4xx_is_dlq_no_retry() -> None:
    db = FakeWorkerDB()
    db.insert_cover_art_attempt(
        job_id=JOB_ID, attempt_id=ATTEMPT_A, prompt="x", trace_id="trace-1",
    )
    db.enqueue(_payload())
    response = httpx.Response(400, request=httpx.Request("POST", "http://x"))
    synth = FakeCoverArtSynthClient(
        exc=httpx.HTTPStatusError(
            "bad", request=response.request, response=response,
        ),
    )
    msg = db.read_one(None, "cover_art_jobs", 120)
    assert msg is not None

    outcome = await process_one_cover_art(
        settings=_settings(),
        db=db,
        storage=FakeStorageClient(),
        synth=synth,
        queue_msg=msg,
    )
    assert outcome == CoverArtOutcome.FAILED_DLQ
    row = db.cover_art_attempts[(JOB_ID, ATTEMPT_A)]
    assert row["status"] == "dlq"
    assert row["error"] == "cover_art_synth_http_4xx"
    assert len(db.dlq) == 1
    assert db.queue[0].deleted is True


@pytest.mark.asyncio
async def test_synth_5xx_retries_then_dlqs_at_max_attempts() -> None:
    db = FakeWorkerDB()
    db.insert_cover_art_attempt(
        job_id=JOB_ID, attempt_id=ATTEMPT_A, prompt="x", trace_id="trace-1",
    )
    db.enqueue(_payload())
    response = httpx.Response(503, request=httpx.Request("POST", "http://x"))
    synth = FakeCoverArtSynthClient(
        exc=httpx.HTTPStatusError(
            "oops", request=response.request, response=response,
        ),
    )

    # First read (read_ct=1) — should re-enqueue.
    msg = db.read_one(None, "cover_art_jobs", 120)
    assert msg is not None
    msg["read_ct"] = 1
    outcome = await process_one_cover_art(
        settings=_settings(), db=db, storage=FakeStorageClient(), synth=synth, queue_msg=msg,
    )
    assert outcome == CoverArtOutcome.FAILED_RETRY
    # A new pgmq message was enqueued.
    live = [m for m in db.queue if not m.archived and not m.deleted]
    assert len(live) == 1
    # Drive read_ct up to max_attempts and confirm DLQ.
    msg2 = db.read_one(None, "cover_art_jobs", 120)
    assert msg2 is not None
    msg2["read_ct"] = 3
    outcome2 = await process_one_cover_art(
        settings=_settings(), db=db, storage=FakeStorageClient(), synth=synth, queue_msg=msg2,
    )
    assert outcome2 == CoverArtOutcome.FAILED_DLQ
    assert len(db.dlq) == 1


@pytest.mark.asyncio
async def test_storage_failure_is_retryable() -> None:
    db = FakeWorkerDB()
    db.insert_cover_art_attempt(
        job_id=JOB_ID, attempt_id=ATTEMPT_A, prompt="x", trace_id="trace-1",
    )
    db.enqueue(_payload())
    storage = FakeStorageClient(fail_on_upload=True, bucket="cover-art")
    msg = db.read_one(None, "cover_art_jobs", 120)
    assert msg is not None
    msg["read_ct"] = 1

    outcome = await process_one_cover_art(
        settings=_settings(),
        db=db,
        storage=storage,
        synth=FakeCoverArtSynthClient(),
        queue_msg=msg,
    )
    assert outcome == CoverArtOutcome.FAILED_RETRY
    row = db.cover_art_attempts[(JOB_ID, ATTEMPT_A)]
    assert row["status"] == "failed"
    assert row["error"] == "cover_art_upload_failed"


@pytest.mark.asyncio
async def test_consumer_loop_drains_then_stops() -> None:
    db = FakeWorkerDB()
    db.insert_cover_art_attempt(
        job_id=JOB_ID, attempt_id=ATTEMPT_A, prompt="x", trace_id="trace-1",
    )
    db.enqueue(_payload())
    stop = asyncio.Event()

    async def trip() -> None:
        # Give the loop a tick to drain, then stop.
        await asyncio.sleep(0.15)
        stop.set()

    await asyncio.gather(
        cover_art_consumer_loop(
            settings=_settings(),
            db=db,
            storage=FakeStorageClient(bucket="cover-art"),
            synth=FakeCoverArtSynthClient(),
            stop=stop,
            poll_interval_seconds=0.05,
        ),
        trip(),
    )
    # The original message is archived; no new live message remains.
    assert all(m.archived or m.deleted for m in db.queue)
