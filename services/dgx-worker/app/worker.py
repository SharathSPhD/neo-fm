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

  Failure paths (ADR 0008 taxonomy):
    - song_document_invalid       -> non-retryable, push to DLQ immediately.
    - inference_http_4xx          -> non-retryable (the request itself is
                                     malformed; retrying without changing the
                                     payload is wasted DGX time). Straight to
                                     DLQ.
    - inference_timeout           -> retryable; new attempt_id, backoff.
    - inference_http_5xx          -> retryable bucket (covers 500, 502, 503,
                                     504 and any other 5xx). Per ADR 0008 we
                                     intentionally do not split per status to
                                     avoid alert fan-out.
    - inference_network_error     -> retryable; treated as 5xx-equivalent.
    - storage_upload_failed       -> retryable.
    - attempts >= max_attempts    -> bumped to DLQ regardless of class.
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

from . import metrics
from .config import Settings, load_settings
from .cover_art_client import CoverArtSynthClient
from .cover_art_worker import cover_art_consumer_loop
from .db import WorkerDB
from .governor import DEFAULT_STATE_PATH, GovernorState, read_state
from .inference_client import MusicInferenceClient
from .mixer import MixSettings, StemInsert, mix_to_stereo_48k
from .models import QueueMessage, SongDocument
from .stem_planner import PlannerSection, plan_stem_inserts
from .stems_client import StemsSynthClient
from .storage import StorageClient
from .vocal_client import VocalSynthClient

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
    """Map an httpx exception to an ADR 0008 error class.

    ADR 0008 buckets inference failures into a small fixed set so dashboards
    and DLQ filters do not fan out per HTTP status. The classes are:

      - ``inference_timeout``       — httpx raised TimeoutException.
      - ``inference_http_4xx``      — non-retryable: the server rejected the
                                     request shape. Caller should DLQ.
      - ``inference_http_5xx``      — retryable: the server failed to honor a
                                     well-formed request (500/502/503/504/etc).
      - ``inference_network_error`` — retryable: the request never reached the
                                     server (connect error, read error, etc).
    """
    if isinstance(exc, httpx.TimeoutException):
        return "inference_timeout"
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if 400 <= status < 500:
            return "inference_http_4xx"
        return "inference_http_5xx"
    return "inference_network_error"


_RETRYABLE_INFERENCE_ERRORS = frozenset(
    {
        "inference_timeout",
        "inference_http_5xx",
        "inference_network_error",
    },
)


def build_vocal_request(
    message: QueueMessage,
    song_document: SongDocument,
    *,
    language: str,
    voice_timbre: str,
) -> dict[str, Any]:
    """Per-language vocalize body. Section lyrics come straight from
    the Song Document; the worker doesn't translate.

    The vocal-synth service handles missing transliteration by
    falling back to lyrics when present.
    """
    # v1.4 Sprint 5: forward the SongDocument-level `voice_id` so the
    # vocal-synth router can swap in the catalogue prompt. Older
    # documents that pre-date the catalogue leave it `None`, which
    # falls back to the language-based routing.
    document_voice_id = getattr(song_document, "voice_id", None)
    return {
        "job_id": str(message.job_id),
        "trace_id": message.trace_id,
        "language": language,
        "style_family": song_document.style_family,
        "voice_timbre": voice_timbre,
        "voice_id": document_voice_id,
        "sample_rate": 48000,
        "target_duration_seconds": song_document.target_duration_seconds,
        "sections": [
            {
                "id": s.id,
                "type": s.type,
                "lyrics": s.lyrics,
                # `language` is an optional extra on the section
                # (model_config extra='allow'); fall back to the song's
                # language when the section doesn't carry one.
                "language": (getattr(s, "language", None) or language),
                "script": s.script,
                "transliteration": s.transliteration,
                # v1.3 Sprint 4: forward co-composer phonemes so the
                # vocal-synth router can hand them to the chosen
                # backend. Older Song Documents that pre-date Sprint 4
                # leave this null; vocal-synth tolerates both.
                "phonemes": s.phonemes,
                "target_seconds": s.target_seconds,
                "tempo_bpm": song_document.tempo_bpm,
                "raga_name": (
                    song_document.raga.get("name")
                    if isinstance(song_document.raga, dict)
                    else None
                ),
                # v1.4 Sprint 5: per-section override falls back to the
                # request-level value in `_coerce`.
                "voice_id": getattr(s, "voice_id", None),
            }
            for s in song_document.sections
        ],
    }


async def _vocalize_all_languages(
    *,
    vocal: VocalSynthClient,
    settings: Settings,
    message: QueueMessage,
    song_document: SongDocument,
) -> tuple[list[bytes], list[str]]:
    """Render one vocal stem per configured language, in parallel.

    Returns (stems, failed_languages). Failures don't abort the job; we
    just produce a partially-vocal song. The worker logs per-language
    failures so the operator dashboard surfaces them.
    """
    if not settings.vocal_languages or not settings.vocal_synth_url:
        return [], []

    async def one(lang: str) -> tuple[str, bytes | BaseException]:
        try:
            wav = await vocal.vocalize(
                request_body=build_vocal_request(
                    message,
                    song_document,
                    language=lang,
                    voice_timbre=settings.vocal_voice_timbre,
                ),
                trace_id=message.trace_id,
            )
            return lang, wav
        except BaseException as exc:  # noqa: BLE001 - we record per-lang failure
            return lang, exc

    tasks = [asyncio.create_task(one(lang)) for lang in settings.vocal_languages]
    results = await asyncio.gather(*tasks)
    stems: list[bytes] = []
    failed: list[str] = []
    for lang, payload in results:
        if isinstance(payload, BaseException):
            LOG.warning(
                "vocal_lang_failed",
                extra={
                    "job_id": str(message.job_id),
                    "language": lang,
                    "err": str(payload),
                },
            )
            metrics.vocal_failures_total.labels(language=lang).inc()
            failed.append(lang)
        else:
            stems.append(payload)
    return stems, failed


async def _fetch_stem_inserts(
    *,
    stems: StemsSynthClient,
    settings: Settings,
    message: QueueMessage,
    song_document: SongDocument,
) -> tuple[list[StemInsert], list[dict[str, Any]]]:
    """Plan + fetch transition stems for this song (v1.4 Sprint 11).

    Returns (inserts, plan_summary). The plan_summary is what the
    worker logs even when individual stem fetches fail; we still want
    operators to see what *was* requested even if the sidecar 503'd.
    Individual stem failures are non-fatal: we just drop that insert
    and continue.
    """
    plan = plan_stem_inserts(
        sections=[
            PlannerSection(id=s.id, target_seconds=float(s.target_seconds))
            for s in song_document.sections
        ],
        style_family=song_document.style_family,
        max_inserts=settings.stems_max_inserts_per_song,
    )
    plan_summary = [
        {
            "preset": p.preset,
            "insert_at_seconds": p.insert_at_seconds,
            "section_index": p.section_index,
        }
        for p in plan
    ]
    if not plan:
        return [], plan_summary

    async def one(p: Any) -> tuple[Any, bytes | BaseException]:
        try:
            wav = await stems.generate_stem(
                request_body={
                    "job_id": str(message.job_id),
                    "attempt_id": str(message.attempt_id),
                    "trace_id": message.trace_id,
                    "style_family": song_document.style_family,
                    "preset": p.preset,
                },
                trace_id=message.trace_id,
            )
            return p, wav
        except BaseException as exc:
            return p, exc

    results = await asyncio.gather(*(one(p) for p in plan))
    inserts: list[StemInsert] = []
    for planned, payload in results:
        if isinstance(payload, BaseException):
            LOG.warning(
                "stem_fetch_failed",
                extra={
                    "job_id": str(message.job_id),
                    "preset": planned.preset,
                    "err": str(payload),
                },
            )
            metrics.stem_failures_total.labels(preset=planned.preset).inc()
            continue
        inserts.append(
            StemInsert(
                audio=payload,
                insert_at_seconds=planned.insert_at_seconds,
                crossfade_seconds=planned.crossfade_seconds,
                label=planned.label,
            )
        )
    return inserts, plan_summary


async def process_one(
    *,
    settings: Settings,
    db: WorkerDB,
    inference: MusicInferenceClient,
    storage: StorageClient,
    queue_msg: dict[str, Any],
    vocal: VocalSynthClient | None = None,
    stems: StemsSynthClient | None = None,
    shutdown: asyncio.Event | None = None,
) -> str:
    """Process a single leased queue message; return one of JobOutcome.*."""
    metrics.in_flight.inc()
    try:
        outcome = await _process_one_impl(
            settings=settings,
            db=db,
            inference=inference,
            storage=storage,
            queue_msg=queue_msg,
            vocal=vocal,
            stems=stems,
            shutdown=shutdown,
        )
    finally:
        metrics.in_flight.dec()
    metrics.jobs_total.labels(outcome=outcome).inc()
    return outcome


async def _process_one_impl(
    *,
    settings: Settings,
    db: WorkerDB,
    inference: MusicInferenceClient,
    storage: StorageClient,
    queue_msg: dict[str, Any],
    vocal: VocalSynthClient | None = None,
    stems: StemsSynthClient | None = None,
    shutdown: asyncio.Event | None = None,
) -> str:
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
        import time as _time  # local import: avoid global churn for tests
        inference_started = _time.perf_counter()
        try:
            if shutdown is not None:
                gen_task = asyncio.create_task(
                    inference.generate(
                        request_body=build_inference_request(message, song_document),
                        trace_id=message.trace_id,
                    ),
                )
                shutdown_task = asyncio.create_task(shutdown.wait())
                done, _pending = await asyncio.wait(
                    {gen_task, shutdown_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if shutdown_task in done and gen_task not in done:
                    # ADR 0011: SIGTERM during inference. Do NOT renew
                    # the lease, do NOT ack the pgmq message. Mark the
                    # job failed with the preempted taxonomy so the
                    # next attempt is classified correctly.
                    gen_task.cancel()
                    with suppress(asyncio.CancelledError, BaseException):
                        await gen_task
                    LOG.warning(
                        "inference_preempted",
                        extra={"job_id": job_id, "trace_id": message.trace_id},
                    )
                    metrics.preempted_total.inc()
                    with db.connect() as conn:
                        db.mark_failed(conn, job_id, "inference_preempted")
                    return JobOutcome.FAILED_RETRY
                shutdown_task.cancel()
                with suppress(asyncio.CancelledError):
                    await shutdown_task
                audio_bytes = await gen_task
            else:
                audio_bytes = await inference.generate(
                    request_body=build_inference_request(message, song_document),
                    trace_id=message.trace_id,
                )
            metrics.inference_seconds.observe(_time.perf_counter() - inference_started)
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            metrics.inference_seconds.observe(_time.perf_counter() - inference_started)
            classification = classify_inference_error(exc)
            LOG.error(
                "inference call failed",
                extra={"job_id": job_id, "err": str(exc), "kind": classification},
            )
            if classification not in _RETRYABLE_INFERENCE_ERRORS:
                # ADR 0008: 4xx means the request itself is malformed; the
                # next attempt would fail identically. Skip retries, DLQ now.
                with db.connect() as conn:
                    db.mark_failed(conn, job_id, classification)
                    db.send_to_dlq(
                        conn,
                        settings.dlq_name,
                        {
                            "reason": classification,
                            "message": raw_payload,
                            "err": str(exc),
                        },
                    )
                    db.delete(conn, settings.queue_name, msg_id)
                return JobOutcome.FAILED_DLQ
            return await _handle_retryable_failure(
                settings=settings,
                db=db,
                message=message,
                msg_id=msg_id,
                error=classification,
                raw_payload=raw_payload,
            )

        # ---- 5b. vocals (parallel per language, optional) ----------------
        vocal_stems: list[bytes] = []
        vocal_failures: list[str] = []
        if vocal is not None and settings.vocal_languages and settings.vocal_synth_url:
            vocal_stems, vocal_failures = await _vocalize_all_languages(
                vocal=vocal,
                settings=settings,
                message=message,
                song_document=song_document,
            )

        # ---- 5b'. transition stems (v1.4 Sprint 11) ----------------------
        stem_inserts: list[StemInsert] = []
        stem_plan_summary: list[dict[str, Any]] = []
        if stems is not None and settings.stems_synth_url:
            stem_inserts, stem_plan_summary = await _fetch_stem_inserts(
                stems=stems,
                settings=settings,
                message=message,
                song_document=song_document,
            )
            if stem_plan_summary:
                LOG.info(
                    "stem_plan",
                    extra={
                        "job_id": job_id,
                        "plan": stem_plan_summary,
                        "rendered": len(stem_inserts),
                    },
                )

        # ---- 5c. mixdown to stereo 48k -----------------------------------
        mix_started = _time.perf_counter()
        try:
            final_audio = mix_to_stereo_48k(
                instrumental_wav=audio_bytes,
                vocal_wavs=vocal_stems or None,
                stem_inserts=stem_inserts or None,
                target_duration_seconds=song_document.target_duration_seconds,
                settings=MixSettings(),
            )
            metrics.mix_seconds.observe(_time.perf_counter() - mix_started)
        except Exception as exc:
            LOG.error(
                "mixdown_failed",
                extra={
                    "job_id": job_id,
                    "err": str(exc),
                    "vocal_failures": vocal_failures,
                    "stem_failures": len(stem_plan_summary) - len(stem_inserts),
                },
            )
            # Mixer failures are retryable: they're not the request's
            # fault, they're a runtime numerics / decode issue.
            return await _handle_retryable_failure(
                settings=settings,
                db=db,
                message=message,
                msg_id=msg_id,
                error="mixdown_failed",
                raw_payload=raw_payload,
            )

        # ---- 6. storage upload (idempotent) ------------------------------
        object_path = storage.object_path(job_id, str(message.attempt_id), "wav")
        try:
            await storage.put_object(
                object_path=object_path,
                content=final_audio,
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
        # Sprint C bug-b: the three mutations below MUST land atomically.
        # If any of them fails after a successful storage upload, the
        # whole block must roll back so the message stays in the queue
        # and the next worker retry will re-insert the track row.
        # psycopg's connection context manager already commits on
        # successful __exit__ / rolls back on exception, but we make
        # the boundary explicit with `conn.transaction()` so a future
        # author who adds a fourth statement here can't accidentally
        # split the transaction. (The user-reported "Audio URL pending"
        # orphan came from an earlier code path that did the storage
        # upload, the insert_track, and the mark_completed across
        # separate connections.)
        with db.connect() as conn:
            with conn.transaction():
                db.insert_track(
                    conn,
                    job_id=job_id,
                    attempt_id=str(message.attempt_id),
                    url=storage.storage_url(object_path),
                    duration_seconds=song_document.target_duration_seconds,
                    format_="wav",
                    bytes_=len(final_audio),
                )
                db.mark_completed(conn, job_id)
                db.archive(conn, settings.queue_name, msg_id)

        LOG.info(
            "job completed",
            extra={
                "job_id": job_id,
                "trace_id": message.trace_id,
                "bytes": len(final_audio),
                "vocal_stems": len(vocal_stems),
                "vocal_failures": vocal_failures,
            },
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
    vocal: VocalSynthClient | None = None
    if settings.vocal_synth_url and settings.vocal_synth_hmac_secret:
        vocal = VocalSynthClient(
            base_url=settings.vocal_synth_url,
            hmac_secret=settings.vocal_synth_hmac_secret,
            timeout_seconds=settings.vocal_synth_timeout_seconds,
        )
    stems: StemsSynthClient | None = None
    if settings.stems_synth_url and settings.stems_synth_hmac_secret:
        stems = StemsSynthClient(
            base_url=settings.stems_synth_url,
            hmac_secret=settings.stems_synth_hmac_secret,
            timeout_seconds=settings.stems_synth_timeout_seconds,
        )
    storage = StorageClient(
        supabase_url=settings.supabase_url,
        service_role_key=settings.supabase_service_role_key,
        bucket=settings.storage_bucket,
    )

    # v1.3 Sprint 3 — separate Storage client targeting the cover-art
    # bucket so the cover-art consumer can upload without coupling to
    # the song-render bucket path convention.
    cover_art_storage: StorageClient | None = None
    cover_art_synth: CoverArtSynthClient | None = None
    if settings.cover_art_synth_url and settings.cover_art_synth_hmac_secret:
        cover_art_storage = StorageClient(
            supabase_url=settings.supabase_url,
            service_role_key=settings.supabase_service_role_key,
            bucket=settings.cover_art_bucket,
        )
        cover_art_synth = CoverArtSynthClient(
            base_url=settings.cover_art_synth_url,
            hmac_secret=settings.cover_art_synth_hmac_secret,
            timeout_seconds=settings.cover_art_synth_timeout_seconds,
        )

    stop = asyncio.Event()
    _install_signal_handlers(stop)

    if settings.metrics_port:
        metrics.start_metrics_server(port=settings.metrics_port)

    cover_art_task: asyncio.Task[None] | None = None
    if cover_art_synth is not None and cover_art_storage is not None:
        cover_art_task = asyncio.create_task(
            cover_art_consumer_loop(
                settings=settings,
                db=db,
                storage=cover_art_storage,
                synth=cover_art_synth,
                stop=stop,
                poll_interval_seconds=settings.cover_art_poll_interval_seconds,
            ),
        )

    LOG.info("worker started", extra={"queue": settings.queue_name})
    last_governor_tenant: str | None = None
    try:
        while not stop.is_set():
            if poll is not None:
                should_continue = await poll()
                if not should_continue:
                    return
                continue

            # ADR 0011: cooperative pre-emption. When the governor has
            # set stop_new_jobs=true we don't read new pgmq messages,
            # but in-flight jobs (none here at the top of the loop)
            # would keep heartbeating. We log the pause once per
            # tenant transition so observability sees who's holding us.
            governor = read_state(settings.governor_state_path)
            metrics.governor_paused.set(1.0 if governor.is_paused else 0.0)
            if governor.is_paused:
                if governor.tenant != last_governor_tenant:
                    LOG.info(
                        "governor_paused",
                        extra={
                            "tenant": governor.tenant,
                            "drain_deadline_ms": governor.drain_deadline_ms,
                        },
                    )
                    last_governor_tenant = governor.tenant
                try:
                    await asyncio.wait_for(stop.wait(), timeout=settings.governor_poll_seconds)
                except TimeoutError:
                    pass
                continue
            if last_governor_tenant is not None:
                LOG.info("governor_resumed", extra={"prev_tenant": last_governor_tenant})
                last_governor_tenant = None

            # Sample queue lag so the operator dashboard can show
            # pressure even between job pickups.
            try:
                with db.connect() as conn:
                    lag = db.queue_lag_seconds(conn)
                metrics.queue_lag_seconds.set(lag if lag is not None else 0.0)
            except Exception as exc:  # noqa: BLE001 - metrics never block the loop
                LOG.debug("queue_lag_sample_failed", extra={"err": str(exc)})

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
                vocal=vocal,
                stems=stems,
                shutdown=stop,
            )
    finally:
        if cover_art_task is not None:
            stop.set()
            cover_art_task.cancel()
            with suppress(asyncio.CancelledError):
                await cover_art_task
        await inference.aclose()
        if vocal is not None:
            await vocal.aclose()
        if cover_art_synth is not None:
            await cover_art_synth.aclose()
        if cover_art_storage is not None:
            await cover_art_storage.aclose()
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
