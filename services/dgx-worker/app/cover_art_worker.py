"""Cover-art pgmq consumer for the dgx-worker (v1.3 Sprint 3).

Lifecycle of one cover-art job:

  1. pgmq.read leases a message from `cover_art_jobs`.
  2. Mark public.cover_art_attempts → status='processing'.
  3. POST to cover-art-synth via HMAC; receive PNG bytes.
  4. Upload PNG to Supabase Storage bucket `cover-art`.
  5. Flip prior public.cover_art rows for this song to is_current=false,
     insert the new public.cover_art row with is_current=true.
  6. Mark attempt → status='completed' + storage_path.
  7. pgmq.archive the message.

  Failure paths:
    - invalid payload          → DLQ immediately + attempt='dlq'.
    - synth 4xx / 5xx / network → record on attempt, re-enqueue if attempts
                                  remain, otherwise DLQ.
    - storage upload failed     → retryable.

This is deliberately a *separate consumer loop* from the main song-render
worker. Cover-art jobs are tiny and frequent; song-render jobs are
huge and slow. Sharing the leased-msg loop would mean a backlog of
cover-art jobs starves real song-renders. Both can run in the same
container; `services/dgx-worker/Dockerfile` will be updated in a
follow-up to start them under one process supervisor.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

import httpx

from . import metrics
from .config import Settings
from .cover_art_client import CoverArtSynthClient
from .db import WorkerDB
from .storage import StorageClient

LOG = logging.getLogger("neo_fm.dgx_worker.cover_art")

DEFAULT_QUEUE_NAME = "cover_art_jobs"
DEFAULT_DLQ_NAME = "cover_art_jobs_dlq"
DEFAULT_VISIBILITY_SECONDS = 120
DEFAULT_MAX_ATTEMPTS = 3


class CoverArtOutcome:
    COMPLETED = "completed"
    FAILED_RETRY = "failed_retry"
    FAILED_DLQ = "failed_dlq"


def _classify_synth_error(exc: BaseException) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "cover_art_synth_timeout"
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if 400 <= status < 500:
            return "cover_art_synth_http_4xx"
        return "cover_art_synth_http_5xx"
    return "cover_art_synth_network_error"


_RETRYABLE_SYNTH_ERRORS = frozenset(
    {
        "cover_art_synth_timeout",
        "cover_art_synth_http_5xx",
        "cover_art_synth_network_error",
    },
)


# ---------------------------------------------------------------------------
# One job
# ---------------------------------------------------------------------------


def _update_attempt_status(
    db: WorkerDB,
    *,
    job_id: str,
    attempt_id: str,
    status: str,
    error: str | None = None,
    storage_path: str | None = None,
    model_version: str | None = None,
) -> None:
    with db.connect() as conn:
        db.update_cover_art_attempt(
            conn,
            job_id=job_id,
            attempt_id=attempt_id,
            status=status,
            error=error,
            storage_path=storage_path,
            model_version=model_version,
        )


async def process_one_cover_art(
    *,
    settings: Settings,
    db: WorkerDB,
    storage: StorageClient,
    synth: CoverArtSynthClient,
    queue_msg: dict[str, Any],
) -> str:
    """Process a single leased cover-art queue message.

    Returns one of CoverArtOutcome.*. The caller is responsible for
    deciding what to do with the returned value (Prometheus accounting,
    log line, etc.).
    """
    msg_id = int(queue_msg["msg_id"])
    raw = queue_msg["message"]
    read_ct = int(queue_msg.get("read_ct", 1))
    queue = settings.cover_art_queue_name or DEFAULT_QUEUE_NAME
    dlq = settings.cover_art_dlq_name or DEFAULT_DLQ_NAME
    max_attempts = settings.cover_art_max_attempts or DEFAULT_MAX_ATTEMPTS

    # ---- 1. validate payload ------------------------------------------------
    try:
        job_id = str(uuid.UUID(str(raw["job_id"])))
        attempt_id = str(uuid.UUID(str(raw["attempt_id"])))
        prompt = str(raw["prompt"]).strip()
        if not prompt:
            raise ValueError("prompt_empty")
        user_id = str(uuid.UUID(str(raw["user_id"])))
        trace_id = str(raw.get("trace_id") or attempt_id)
    except (KeyError, ValueError, TypeError) as exc:
        LOG.error("cover_art_invalid_payload", extra={"err": str(exc), "raw": raw})
        with db.connect() as conn:
            db.send_to_dlq(conn, dlq, {"reason": "invalid_payload", "raw": raw, "err": str(exc)})
            db.delete(conn, queue, msg_id)
        metrics.cover_art_jobs_total.labels(outcome=CoverArtOutcome.FAILED_DLQ).inc()
        return CoverArtOutcome.FAILED_DLQ

    # ---- 2. mark attempt → processing --------------------------------------
    _update_attempt_status(db, job_id=job_id, attempt_id=attempt_id, status="processing")

    # ---- 3. call cover-art-synth -------------------------------------------
    style_family = raw.get("style_family") if isinstance(raw, dict) else None
    seed = raw.get("seed") if isinstance(raw, dict) else None
    request_body = {
        "job_id": job_id,
        "attempt_id": attempt_id,
        "trace_id": trace_id,
        "prompt": prompt,
        "style_family": style_family,
        "seed": seed,
    }
    try:
        png_bytes, model_version, backend = await synth.generate_cover(
            request_body=request_body,
            trace_id=trace_id,
        )
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        classification = _classify_synth_error(exc)
        LOG.error(
            "cover_art_synth_failed",
            extra={
                "job_id": job_id,
                "attempt_id": attempt_id,
                "err": str(exc),
                "kind": classification,
            },
        )
        # Non-retryable 4xx → straight to DLQ.
        if classification not in _RETRYABLE_SYNTH_ERRORS:
            _update_attempt_status(
                db,
                job_id=job_id,
                attempt_id=attempt_id,
                status="dlq",
                error=classification,
            )
            with db.connect() as conn:
                db.send_to_dlq(conn, dlq, {"reason": classification, "raw": raw})
                db.delete(conn, queue, msg_id)
            metrics.cover_art_jobs_total.labels(outcome=CoverArtOutcome.FAILED_DLQ).inc()
            return CoverArtOutcome.FAILED_DLQ
        return await _handle_retryable(
            settings=settings,
            db=db,
            queue=queue,
            dlq=dlq,
            msg_id=msg_id,
            raw_payload=raw,
            job_id=job_id,
            attempt_id=attempt_id,
            classification=classification,
            read_ct=read_ct,
            max_attempts=max_attempts,
        )

    # ---- 4. upload to Supabase Storage -------------------------------------
    storage_path = f"{user_id}/{job_id}/{attempt_id}.png"
    try:
        await storage.put_object(
            object_path=storage_path,
            content=png_bytes,
            content_type="image/png",
        )
    except Exception as exc:
        LOG.error(
            "cover_art_upload_failed",
            extra={"job_id": job_id, "attempt_id": attempt_id, "err": str(exc)},
        )
        return await _handle_retryable(
            settings=settings,
            db=db,
            queue=queue,
            dlq=dlq,
            msg_id=msg_id,
            raw_payload=raw,
            job_id=job_id,
            attempt_id=attempt_id,
            classification="cover_art_upload_failed",
            read_ct=read_ct,
            max_attempts=max_attempts,
        )

    # ---- 5. insert cover_art row + mark attempt completed (transactional) ---
    try:
        with db.connect() as conn:
            db.flip_current_cover_art(
                conn,
                job_id=job_id,
                storage_url=f"cover-art/{storage_path}",
                prompt=prompt,
                model_version=model_version,
            )
    except Exception as exc:
        LOG.error(
            "cover_art_db_write_failed",
            extra={"job_id": job_id, "attempt_id": attempt_id, "err": str(exc)},
        )
        return await _handle_retryable(
            settings=settings,
            db=db,
            queue=queue,
            dlq=dlq,
            msg_id=msg_id,
            raw_payload=raw,
            job_id=job_id,
            attempt_id=attempt_id,
            classification="cover_art_db_write_failed",
            read_ct=read_ct,
            max_attempts=max_attempts,
        )

    _update_attempt_status(
        db,
        job_id=job_id,
        attempt_id=attempt_id,
        status="completed",
        storage_path=storage_path,
        model_version=model_version,
    )

    with db.connect() as conn:
        db.archive(conn, queue, msg_id)

    LOG.info(
        "cover_art_job_completed",
        extra={
            "job_id": job_id,
            "attempt_id": attempt_id,
            "backend": backend,
            "model_version": model_version,
            "bytes": len(png_bytes),
        },
    )
    metrics.cover_art_jobs_total.labels(outcome=CoverArtOutcome.COMPLETED).inc()
    return CoverArtOutcome.COMPLETED


async def _handle_retryable(
    *,
    settings: Settings,
    db: WorkerDB,
    queue: str,
    dlq: str,
    msg_id: int,
    raw_payload: Any,
    job_id: str,
    attempt_id: str,
    classification: str,
    read_ct: int,
    max_attempts: int,
) -> str:
    """Either re-enqueue with a fresh attempt_id, or DLQ."""
    if read_ct >= max_attempts:
        _update_attempt_status(
            db,
            job_id=job_id,
            attempt_id=attempt_id,
            status="dlq",
            error=classification,
        )
        with db.connect() as conn:
            db.send_to_dlq(
                conn,
                dlq,
                {"reason": classification, "raw": raw_payload, "attempts": read_ct},
            )
            db.delete(conn, queue, msg_id)
        metrics.cover_art_jobs_total.labels(outcome=CoverArtOutcome.FAILED_DLQ).inc()
        return CoverArtOutcome.FAILED_DLQ

    _update_attempt_status(
        db,
        job_id=job_id,
        attempt_id=attempt_id,
        status="failed",
        error=classification,
    )
    next_payload = dict(raw_payload) if isinstance(raw_payload, dict) else {}
    next_payload["attempt_id"] = str(uuid.uuid4())
    with db.connect() as conn:
        db.reenqueue(conn, queue, next_payload)
        db.delete(conn, queue, msg_id)
    metrics.cover_art_jobs_total.labels(outcome=CoverArtOutcome.FAILED_RETRY).inc()
    return CoverArtOutcome.FAILED_RETRY


# ---------------------------------------------------------------------------
# Long-running consumer loop (separate from the song-render loop)
# ---------------------------------------------------------------------------


async def cover_art_consumer_loop(
    *,
    settings: Settings,
    db: WorkerDB,
    storage: StorageClient,
    synth: CoverArtSynthClient,
    stop: asyncio.Event,
    poll_interval_seconds: float = 2.0,
) -> None:
    queue = settings.cover_art_queue_name or DEFAULT_QUEUE_NAME
    vt = settings.cover_art_visibility_seconds or DEFAULT_VISIBILITY_SECONDS
    LOG.info("cover_art_consumer_started", extra={"queue": queue})
    try:
        while not stop.is_set():
            try:
                with db.connect() as conn:
                    msg = db.read_one(conn, queue, vt)
            except Exception as exc:  # never abort the loop on a transient db error
                LOG.warning("cover_art_read_failed", extra={"err": str(exc)})
                msg = None
            if msg is None:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=poll_interval_seconds)
                except TimeoutError:
                    pass
                continue
            try:
                await process_one_cover_art(
                    settings=settings,
                    db=db,
                    storage=storage,
                    synth=synth,
                    queue_msg=msg,
                )
            except Exception:
                LOG.exception("cover_art_consumer_loop_error")
    finally:
        LOG.info("cover_art_consumer_stopped")


__all__ = [
    "CoverArtOutcome",
    "cover_art_consumer_loop",
    "process_one_cover_art",
]
