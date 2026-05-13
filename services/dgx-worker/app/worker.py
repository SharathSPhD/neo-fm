"""Phase 4 dgx-worker main loop.

Lifecycle of one job:

  1. `pgmq.read` leases a message with visibility_timeout (ADR 0008).
  2. CAS the `jobs` row from queued -> processing (atomic; idempotent).
  3. Spawn a heartbeat task that, every heartbeat_interval, calls
     `pgmq.set_vt` and bumps `jobs.lease_renewed_at`.
  4. Fetch the song document; build the inference request DTO.
  5. POST to music-inference via HMAC client.
  6. Upload WAV to Storage (idempotent on the bucket path).
  7. Insert into `tracks` (idempotent on (job_id, attempt_id)).
  8. Mark job completed (CAS from processing).
  9. `pgmq.archive` the message.

  Failure paths:
    - song_document_invalid -> non-retryable, push to DLQ immediately.
    - inference_oom / inference_timeout / inference_http_5xx /
      storage_upload_failed -> mark failed; if attempts < max, re-enqueue
      with backoff; else push to DLQ.
"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys
import uuid
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any

import httpx
from pydantic import ValidationError

from .config import Settings, load_settings
from .db import WorkerDB
from .inference_client import MusicInferenceClient
from .models import QueueMessage, SongDocument
from .storage import StorageClient

LOG = logging.getLogger("neo_fm.dgx_worker")


class JobOutcome:
    COMPLETED = "completed"
    FAILED_RETRY = "failed_retry"
    FAILED_DLQ = "failed_dlq"


def build_inference_request(message: QueueMessage, song_document: SongDocument) -> dict[str, Any]:
    """Translate (queue message + song document) into the music-inference body.

    Mirrors the structure expected by openapi-dgx.yaml. Sections from the
    Song Document get forwarded verbatim (the worker is intentionally dumb
    about co-composition semantics; that's Phase 2's job).
    """
    return {
        "job_id": str(message.job_id),
        "trace_id": message.trace_id,
        "language": song_document.language,
        "style_family": song_document.style_family,
        "target_duration_seconds": song_document.target_duration_seconds,
        "tempo_bpm": song_document.tempo_bpm,
        "time_signature": song_document.time_signature,
        "raga": song_document.raga,
        "orchestration": song_document.orchestration,
        "sections": [s.model_dump(exclude_none=True) for s in song_document.sections],
    }


async def _heartbeat_loop(
    *,
    db: WorkerDB,
    queue_name: str,
    msg_id: int,
    job_id: str,
    vt_seconds: int,
    interval_seconds: int,
    stop: asyncio.Event,
) -> None:
    """Renew the pgmq lease and jobs.lease_renewed_at periodically."""
    while not stop.is_set():
        try:
            with db.connect() as conn:
                db.set_visibility_timeout(conn, queue_name, msg_id, vt_seconds)
                db.renew_lease(conn, job_id)
        except Exception as exc:
            LOG.warning("heartbeat failed", extra={"job_id": job_id, "err": str(exc)})
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
        except TimeoutError:
            continue


def classify_inference_error(exc: BaseException) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "inference_timeout"
    if isinstance(exc, httpx.HTTPStatusError):
        return f"inference_http_{exc.response.status_code}"
    return "inference_http_5xx"


async def process_one(
    *,
    settings: Settings,
    db: WorkerDB,
    inference: MusicInferenceClient,
    storage: StorageClient,
    queue_msg: dict[str, Any],
) -> str:
    """Process a single leased queue message; return one of JobOutcome.*."""
    msg_id = int(queue_msg["msg_id"])
    raw_payload = queue_msg["message"]

    # ---- 1. payload validation (non-retryable on failure) ---------------
    try:
        message = QueueMessage.model_validate(raw_payload)
    except ValidationError as exc:
        LOG.error("invalid queue payload", extra={"err": str(exc)})
        dlq_payload = {
            "reason": "invalid_payload",
            "raw": raw_payload,
            "err": str(exc),
        }
        with db.connect() as conn:
            db.send_to_dlq(conn, settings.dlq_name, dlq_payload)
            db.delete(conn, settings.queue_name, msg_id)
        return JobOutcome.FAILED_DLQ

    job_id = str(message.job_id)

    # ---- 2. CAS to processing -------------------------------------------
    with db.connect() as conn:
        claimed = db.claim_job_processing(
            conn,
            job_id,
            str(message.attempt_id),
            message.trace_id,
            stale_lease_seconds=settings.visibility_timeout_seconds,
            expected_user_id=str(message.user_id),
            expected_song_document_id=str(message.song_document_id),
        )
        if not claimed:
            # Another live worker still holds the lease, the job is
            # already terminal, or the queue message is for a different
            # user/document than the persisted job row. In every case the
            # right move is to archive and skip rather than process.
            db.archive(conn, settings.queue_name, msg_id)
            LOG.info(
                "job not claimable; archived without processing",
                extra={"job_id": job_id, "trace_id": message.trace_id},
            )
            return JobOutcome.COMPLETED

    # ---- 3. heartbeat -----------------------------------------------------
    stop = asyncio.Event()
    heartbeat = asyncio.create_task(
        _heartbeat_loop(
            db=db,
            queue_name=settings.queue_name,
            msg_id=msg_id,
            job_id=job_id,
            vt_seconds=settings.visibility_timeout_seconds,
            interval_seconds=settings.heartbeat_interval_seconds,
            stop=stop,
        ),
    )

    try:
        # ---- 4. fetch song document --------------------------------------
        try:
            with db.connect() as conn:
                song_document = db.fetch_song_document(conn, str(message.song_document_id))
        except (LookupError, ValidationError) as exc:
            LOG.error("song_document_invalid", extra={"job_id": job_id, "err": str(exc)})
            with db.connect() as conn:
                db.mark_failed(conn, job_id, "song_document_invalid")
                db.send_to_dlq(
                    conn,
                    settings.dlq_name,
                    {"reason": "song_document_invalid", "message": raw_payload, "err": str(exc)},
                )
                db.delete(conn, settings.queue_name, msg_id)
            return JobOutcome.FAILED_DLQ

        # ---- 5. inference -------------------------------------------------
        try:
            audio_bytes = await inference.generate(
                request_body=build_inference_request(message, song_document),
                trace_id=message.trace_id,
            )
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            classification = classify_inference_error(exc)
            LOG.error(
                "inference call failed",
                extra={"job_id": job_id, "err": str(exc), "kind": classification},
            )
            return await _handle_retryable_failure(
                settings=settings,
                db=db,
                message=message,
                msg_id=msg_id,
                error=classification,
                raw_payload=raw_payload,
            )

        # ---- 6. storage upload (idempotent) ------------------------------
        object_path = storage.object_path(job_id, str(message.attempt_id), "wav")
        try:
            await storage.put_object(
                object_path=object_path,
                content=audio_bytes,
                content_type="audio/wav",
            )
        except Exception as exc:
            LOG.error("storage upload failed", extra={"job_id": job_id, "err": str(exc)})
            return await _handle_retryable_failure(
                settings=settings,
                db=db,
                message=message,
                msg_id=msg_id,
                error="storage_upload_failed",
                raw_payload=raw_payload,
            )

        # ---- 7+8. track + completed --------------------------------------
        with db.connect() as conn:
            db.insert_track(
                conn,
                job_id=job_id,
                attempt_id=str(message.attempt_id),
                url=storage.storage_url(object_path),
                duration_seconds=song_document.target_duration_seconds,
                format_="wav",
                bytes_=len(audio_bytes),
            )
            db.mark_completed(conn, job_id)
            db.archive(conn, settings.queue_name, msg_id)

        LOG.info(
            "job completed",
            extra={"job_id": job_id, "trace_id": message.trace_id, "bytes": len(audio_bytes)},
        )
        return JobOutcome.COMPLETED

    finally:
        stop.set()
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat


async def _handle_retryable_failure(
    *,
    settings: Settings,
    db: WorkerDB,
    message: QueueMessage,
    msg_id: int,
    error: str,
    raw_payload: dict[str, Any],
) -> str:
    """Mark failed; re-enqueue with backoff or DLQ if attempts exhausted."""
    with db.connect() as conn:
        db.mark_failed(conn, str(message.job_id), error)
        db.delete(conn, settings.queue_name, msg_id)

        if message.attempt_number >= settings.max_attempts:
            db.send_to_dlq(
                conn,
                settings.dlq_name,
                {"reason": error, "message": raw_payload},
            )
            return JobOutcome.FAILED_DLQ

        next_payload = dict(raw_payload)
        next_payload["attempt_id"] = str(uuid.uuid4())
        next_payload["attempt_number"] = message.attempt_number + 1
        db.reenqueue(conn, settings.queue_name, next_payload)
        return JobOutcome.FAILED_RETRY


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


def _configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter(
        '{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
    )
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)


def _install_signal_handlers(stop: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)


async def main_loop(
    settings: Settings | None = None,
    *,
    poll: Callable[[], Awaitable[bool]] | None = None,
) -> None:
    """Main worker loop. `poll` is exposed for tests so they can run one cycle."""
    settings = settings or load_settings()
    db = WorkerDB(settings.pg_dsn)
    inference = MusicInferenceClient(
        base_url=settings.music_inference_url,
        hmac_secret=settings.music_inference_hmac_secret,
        timeout_seconds=settings.music_inference_timeout_seconds,
    )
    storage = StorageClient(
        supabase_url=settings.supabase_url,
        service_role_key=settings.supabase_service_role_key,
        bucket=settings.storage_bucket,
    )

    stop = asyncio.Event()
    _install_signal_handlers(stop)

    LOG.info("worker started", extra={"queue": settings.queue_name})
    try:
        while not stop.is_set():
            if poll is not None:
                should_continue = await poll()
                if not should_continue:
                    return
                continue

            with db.connect() as conn:
                msg = db.read_one(conn, settings.queue_name, settings.visibility_timeout_seconds)
            if msg is None:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=settings.poll_interval_seconds)
                except TimeoutError:
                    pass
                continue
            await process_one(
                settings=settings,
                db=db,
                inference=inference,
                storage=storage,
                queue_msg=msg,
            )
    finally:
        await inference.aclose()
        await storage.aclose()
        LOG.info("worker stopped")


def main() -> int:
    _configure_logging()
    try:
        asyncio.run(main_loop())
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
