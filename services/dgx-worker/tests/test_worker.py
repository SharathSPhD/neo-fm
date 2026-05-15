"""End-to-end exercise of `process_one` with the in-memory fakes."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.worker import JobOutcome, process_one

from .fakes import (
    FakeInferenceClient,
    FakeJob,
    FakeStorageClient,
    FakeWorkerDB,
    make_message,
    make_song_document,
)


def _settings(**overrides: object) -> Settings:
    base = Settings(
        pg_dsn="postgres://test",
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="srk",
        storage_bucket="tracks",
        music_inference_url="https://inference.test",
        music_inference_hmac_secret="hmac",
        music_inference_timeout_seconds=10.0,
        # Sprint 5: vocal-synth is opt-in via env. Default tests run
        # instrumental-only so the existing matrix stays representative
        # of the no-GPU dev path.
        vocal_synth_url="",
        vocal_synth_hmac_secret="",
        vocal_synth_timeout_seconds=10.0,
        vocal_languages=(),
        vocal_voice_timbre="androgynous",
        queue_name="song_generation_jobs",
        dlq_name="song_generation_jobs_dlq",
        visibility_timeout_seconds=300,
        heartbeat_interval_seconds=60,
        poll_interval_seconds=0.1,
        max_attempts=3,
        # ADR 0011 governor: point at a path that is unlikely to exist
        # so default tests keep behaving as "no governor active".
        governor_state_path=Path("/tmp/neo-fm-governor-disabled.state"),
        governor_poll_seconds=0.01,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


def _seed(db: FakeWorkerDB, *, message: dict[str, object]) -> int:
    job_id = str(message["job_id"])
    user_id = str(message["user_id"])
    song_id = str(message["song_document_id"])
    db.jobs[job_id] = FakeJob(user_id=user_id, song_document_id=song_id)
    db.song_documents[song_id] = make_song_document()
    return db.enqueue(message)


async def test_happy_path_writes_track_completes_and_archives() -> None:
    db = FakeWorkerDB()
    inference = FakeInferenceClient()
    storage = FakeStorageClient()
    msg = make_message()
    msg_id = _seed(db, message=msg)

    outcome = await process_one(
        settings=_settings(),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    assert outcome == JobOutcome.COMPLETED
    job = db.jobs[str(msg["job_id"])]
    assert job.status == "completed"
    assert job.attempts == 1
    assert job.attempt_id == msg["attempt_id"]
    assert job.error is None

    # storage upload happened exactly once at the conventional path; the
    # actual bytes are the mixer's stereo 48k WAV (not the raw bytes
    # returned by the inference fake) -- Sprint 5 added mix_to_stereo_48k.
    assert len(storage.uploads) == 1
    path, content, ctype = storage.uploads[0]
    assert path == f"{msg['job_id']}/{msg['attempt_id']}.wav"
    assert content[:4] == b"RIFF"
    assert content[8:12] == b"WAVE"
    assert ctype == "audio/wav"

    # track row inserted (idempotency key (job_id, attempt_id))
    assert len(db.tracks) == 1
    assert db.tracks[0].url == f"tracks/{msg['job_id']}/{msg['attempt_id']}.wav"

    # queue message archived, not deleted
    assert db.queue[0].archived is True
    assert db.queue[0].deleted is False


async def test_invalid_payload_routes_to_dlq() -> None:
    db = FakeWorkerDB()
    inference = FakeInferenceClient()
    storage = FakeStorageClient()
    msg_id = db.enqueue({"not": "a queue message"})

    outcome = await process_one(
        settings=_settings(),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": {"not": "a queue message"}},
    )

    assert outcome == JobOutcome.FAILED_DLQ
    assert len(db.dlq) == 1
    assert db.dlq[0]["reason"] == "invalid_payload"
    assert db.queue[0].deleted is True
    # No tracks, no inference calls.
    assert inference.calls == []
    assert storage.uploads == []


async def test_missing_song_document_marks_failed_and_dlqs() -> None:
    db = FakeWorkerDB()
    inference = FakeInferenceClient()
    storage = FakeStorageClient()
    msg = make_message()
    job_id = str(msg["job_id"])
    db.jobs[job_id] = FakeJob(
        user_id=str(msg["user_id"]),
        song_document_id=str(msg["song_document_id"]),
    )
    # Note: no song_documents[...] entry.
    msg_id = db.enqueue(msg)

    outcome = await process_one(
        settings=_settings(),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    assert outcome == JobOutcome.FAILED_DLQ
    assert db.jobs[job_id].status == "failed"
    assert db.jobs[job_id].error == "song_document_invalid"
    assert any(d["reason"] == "song_document_invalid" for d in db.dlq)
    assert db.queue[0].deleted is True


async def test_inference_timeout_retries_with_new_attempt_id() -> None:
    db = FakeWorkerDB()
    inference = FakeInferenceClient(
        exc=httpx.TimeoutException("timed out", request=httpx.Request("POST", "http://x")),
    )
    storage = FakeStorageClient()
    msg = make_message(attempt_number=1)
    msg_id = _seed(db, message=msg)
    settings = _settings(max_attempts=3)

    outcome = await process_one(
        settings=settings,
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    assert outcome == JobOutcome.FAILED_RETRY
    job = db.jobs[str(msg["job_id"])]
    assert job.status == "failed"
    assert job.error == "inference_timeout"
    # Original message removed from the queue; a new one enqueued.
    assert db.queue[0].deleted is True


async def test_attempts_exhausted_routes_to_dlq() -> None:
    """5xx (retryable bucket) past max_attempts ends up in DLQ.

    Tagged as `inference_http_5xx` per ADR 0008 — we do NOT fan the bucket out
    by status code; 500/502/503/504 all collapse to the same class.
    """
    db = FakeWorkerDB()
    inference = FakeInferenceClient(
        exc=httpx.HTTPStatusError(
            "boom",
            request=httpx.Request("POST", "http://x"),
            response=httpx.Response(503),
        ),
    )
    storage = FakeStorageClient()
    msg = make_message(attempt_number=3)
    msg_id = _seed(db, message=msg)
    settings = _settings(max_attempts=3)

    outcome = await process_one(
        settings=settings,
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    assert outcome == JobOutcome.FAILED_DLQ
    assert db.jobs[str(msg["job_id"])].status == "failed"
    assert db.jobs[str(msg["job_id"])].error == "inference_http_5xx"
    assert any(d["reason"] == "inference_http_5xx" for d in db.dlq)


async def test_inference_4xx_routes_straight_to_dlq() -> None:
    """4xx is non-retryable per ADR 0008: the next attempt would fail
    identically. Even on the first attempt, the job goes straight to DLQ."""
    db = FakeWorkerDB()
    inference = FakeInferenceClient(
        exc=httpx.HTTPStatusError(
            "bad request",
            request=httpx.Request("POST", "http://x"),
            response=httpx.Response(400),
        ),
    )
    storage = FakeStorageClient()
    msg = make_message(attempt_number=1)
    msg_id = _seed(db, message=msg)
    settings = _settings(max_attempts=3)

    outcome = await process_one(
        settings=settings,
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    assert outcome == JobOutcome.FAILED_DLQ
    job = db.jobs[str(msg["job_id"])]
    assert job.status == "failed"
    assert job.error == "inference_http_4xx"
    # DLQ holds the failure; the original queue message was deleted (not
    # re-enqueued), so we don't burn DGX time on a doomed retry.
    assert any(d["reason"] == "inference_http_4xx" for d in db.dlq)
    assert db.queue[0].deleted is True
    assert storage.uploads == []
    assert db.tracks == []


async def test_inference_network_error_is_retryable() -> None:
    """Connect errors / read errors should be treated as retryable 5xx-like
    failures (ADR 0008 `inference_network_error` bucket)."""
    db = FakeWorkerDB()
    inference = FakeInferenceClient(
        exc=httpx.ConnectError(
            "connection refused",
            request=httpx.Request("POST", "http://x"),
        ),
    )
    storage = FakeStorageClient()
    msg = make_message(attempt_number=1)
    msg_id = _seed(db, message=msg)
    settings = _settings(max_attempts=3)

    outcome = await process_one(
        settings=settings,
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    assert outcome == JobOutcome.FAILED_RETRY
    assert db.jobs[str(msg["job_id"])].error == "inference_network_error"


async def test_storage_failure_is_retryable() -> None:
    db = FakeWorkerDB()
    inference = FakeInferenceClient()
    storage = FakeStorageClient(fail_on_upload=True)
    msg = make_message()
    msg_id = _seed(db, message=msg)

    outcome = await process_one(
        settings=_settings(),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    assert outcome == JobOutcome.FAILED_RETRY
    assert db.jobs[str(msg["job_id"])].error == "storage_upload_failed"


async def test_redelivery_while_lease_is_fresh_does_not_steal_job() -> None:
    """If pgmq redelivers a message while the original worker is still
    heartbeating, the second processor must NOT be able to claim the job.

    Regression for the Phase 4 adversarial-review finding "CAS allows
    takeover from processing".
    """
    db = FakeWorkerDB()
    inference = FakeInferenceClient()
    storage = FakeStorageClient()
    msg = make_message()
    job_id = str(msg["job_id"])

    # Seed the job and mark it processing with a *fresh* lease.
    db.jobs[job_id] = FakeJob(
        user_id=str(msg["user_id"]),
        song_document_id=str(msg["song_document_id"]),
        status="processing",
        attempts=1,
        attempt_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        trace_id="prior-trace",
    )
    db.jobs[job_id]._lease_renewed_at_epoch = __import__("time").time()  # type: ignore[attr-defined]
    db.song_documents[str(msg["song_document_id"])] = make_song_document()
    msg_id = db.enqueue(msg)

    outcome = await process_one(
        settings=_settings(visibility_timeout_seconds=300),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    # The second worker must have bailed out without uploading/track-ing.
    assert outcome == JobOutcome.COMPLETED  # archived without processing
    assert inference.calls == []
    assert storage.uploads == []
    assert db.tracks == []
    # The job stays in processing under the *original* attempt_id.
    assert db.jobs[job_id].attempt_id == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    assert db.queue[0].archived is True


async def test_queue_payload_mismatched_user_id_is_rejected() -> None:
    """Queue payload trust boundary: if the message claims a job belongs
    to user X but the persisted row is owned by user Y, the worker must
    refuse the claim. Regression for the adversarial-review finding
    "Queue payload trust boundary"."""
    db = FakeWorkerDB()
    inference = FakeInferenceClient()
    storage = FakeStorageClient()
    msg = make_message()
    job_id = str(msg["job_id"])
    # The persisted job is owned by a different user than the message claims.
    db.jobs[job_id] = FakeJob(
        user_id="99999999-9999-9999-9999-999999999999",
        song_document_id=str(msg["song_document_id"]),
        status="queued",
    )
    db.song_documents[str(msg["song_document_id"])] = make_song_document()
    msg_id = db.enqueue(msg)

    outcome = await process_one(
        settings=_settings(),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    assert outcome == JobOutcome.COMPLETED
    # No work was performed under another user's job.
    assert inference.calls == []
    assert storage.uploads == []
    assert db.tracks == []


async def test_idempotent_replay_does_not_double_insert_track() -> None:
    db = FakeWorkerDB()
    inference = FakeInferenceClient()
    storage = FakeStorageClient()
    msg = make_message()
    msg_id = _seed(db, message=msg)

    await process_one(
        settings=_settings(),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    # Simulate redelivery of the same message (same attempt_id).
    msg_id2 = db.enqueue(msg)
    outcome = await process_one(
        settings=_settings(),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id2, "message": msg},
    )

    # Job already completed; CAS returns False so we archive without raising.
    assert outcome == JobOutcome.COMPLETED
    assert len(db.tracks) == 1  # idempotent on (job_id, attempt_id)


@pytest.mark.asyncio
async def test_heartbeat_loop_runs_during_long_inference(monkeypatch: pytest.MonkeyPatch) -> None:
    """The pgmq lease must be renewed while inference is in flight."""
    db = FakeWorkerDB()
    msg = make_message()
    msg_id = _seed(db, message=msg)

    # 0.05s heartbeat interval, ~0.15s "inference" call => ~3 renews.
    inference = FakeInferenceClient()
    canonical_wav = inference.response

    async def slow_generate(**_: object) -> bytes:
        await asyncio.sleep(0.15)
        return canonical_wav

    monkeypatch.setattr(inference, "generate", slow_generate)
    storage = FakeStorageClient()

    settings = _settings(heartbeat_interval_seconds=0)  # 0 == as-fast-as-possible
    # The Settings dataclass is frozen; set the asyncio.wait_for timeout floor by
    # patching the heartbeat sleep to use a 50ms tick directly.
    from app import worker as worker_mod  # local import to mutate the module fn

    real_loop = worker_mod._heartbeat_loop

    async def fast_heartbeat(*, db, queue_name, msg_id, job_id, vt_seconds, interval_seconds, stop):  # type: ignore[no-untyped-def]
        await real_loop(
            db=db,
            queue_name=queue_name,
            msg_id=msg_id,
            job_id=job_id,
            vt_seconds=vt_seconds,
            interval_seconds=0.05,  # type: ignore[arg-type]
            stop=stop,
        )

    monkeypatch.setattr(worker_mod, "_heartbeat_loop", fast_heartbeat)

    outcome = await process_one(
        settings=settings,
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    assert outcome == JobOutcome.COMPLETED
    # At least one VT extension fired (msg_id heartbeat).
    assert any(kind == "vt" for _, kind in db.heartbeats)
    # And at least one job-side lease renewal fired (job_id heartbeat).
    assert any(kind == str(msg["job_id"]) for _, kind in db.heartbeats)
