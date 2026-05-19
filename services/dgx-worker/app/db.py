"""Thin Postgres + pgmq client.

Connects as the dedicated `neo_fm_worker` role created by migration
`0006_worker_role.sql`. The role has UPDATE on a column-allow-list for
`jobs`, INSERT on `tracks`, and read access to `song_documents` plus full
pgmq surface.

Uses synchronous psycopg under the hood and a single connection per worker
loop iteration. The pgmq calls return tuples that we translate into the
shape that `worker.py` expects.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row

from .models import SongDocument


class WorkerDB:
    """Wraps a psycopg connection for one worker iteration."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @contextmanager
    def connect(self) -> Iterator[psycopg.Connection[dict[str, Any]]]:
        with psycopg.connect(self._dsn, row_factory=dict_row) as conn:
            yield conn

    # ----- pgmq surface ---------------------------------------------------

    def read_one(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        queue_name: str,
        visibility_timeout_seconds: int,
    ) -> dict[str, Any] | None:
        """Lease at most one message from the queue. Returns None if empty."""
        with conn.cursor() as cur:
            cur.execute(
                "select * from pgmq.read(%s, %s, %s);",
                (queue_name, visibility_timeout_seconds, 1),
            )
            row = cur.fetchone()
            if not row:
                return None
            # pgmq.read returns (msg_id, read_ct, enqueued_at, vt, message)
            # The message column is jsonb; psycopg gives us a dict directly.
            return row

    def set_visibility_timeout(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        queue_name: str,
        msg_id: int,
        visibility_timeout_seconds: int,
    ) -> None:
        with conn.cursor() as cur:
            cur.execute(
                "select pgmq.set_vt(%s, %s, %s);",
                (queue_name, msg_id, visibility_timeout_seconds),
            )

    def archive(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        queue_name: str,
        msg_id: int,
    ) -> None:
        with conn.cursor() as cur:
            cur.execute("select pgmq.archive(%s, %s);", (queue_name, msg_id))

    def delete(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        queue_name: str,
        msg_id: int,
    ) -> None:
        with conn.cursor() as cur:
            cur.execute("select pgmq.delete(%s, %s);", (queue_name, msg_id))

    def send_to_dlq(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        dlq_name: str,
        payload: dict[str, Any],
    ) -> int:
        return self._pgmq_send(conn, dlq_name, payload)

    def reenqueue(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        queue_name: str,
        payload: dict[str, Any],
    ) -> int:
        """Push a retry attempt back onto the primary queue."""
        return self._pgmq_send(conn, queue_name, payload)

    def _pgmq_send(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        queue_name: str,
        payload: dict[str, Any],
    ) -> int:
        with conn.cursor() as cur:
            cur.execute(
                "select pgmq.send(%s, %s::jsonb);",
                (queue_name, json.dumps(payload)),
            )
            row = cur.fetchone()
            assert row is not None
            return int(row["send"])

    # ----- domain operations ---------------------------------------------

    def fetch_song_document(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        song_document_id: str,
    ) -> SongDocument:
        with conn.cursor() as cur:
            cur.execute(
                "select document_json from public.song_documents where id = %s;",
                (song_document_id,),
            )
            row = cur.fetchone()
            if not row:
                raise LookupError(f"song_document {song_document_id} not found")
            doc = row["document_json"]
            if isinstance(doc, str):
                doc = json.loads(doc)
            # Defensively fill target_seconds if sections are missing it.
            # Mirrors allocate_section_durations() in the song-doc package.
            sections = doc.get("sections", [])
            total = int(doc.get("target_duration_seconds", 0))
            if total and any("target_seconds" not in s for s in sections):
                unset = [s for s in sections if "target_seconds" not in s]
                fixed = sum(int(s["target_seconds"]) for s in sections if "target_seconds" in s)
                per, extra = divmod(total - fixed, len(unset))
                i = 0
                patched: list[object] = []
                for s in sections:
                    if "target_seconds" in s:
                        patched.append(s)
                    else:
                        patched.append({**s, "target_seconds": per + (1 if i < extra else 0)})
                        i += 1
                doc = {**doc, "sections": patched}
            return SongDocument.model_validate(doc)

    def claim_job_processing(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        job_id: str,
        attempt_id: str,
        trace_id: str,
        *,
        stale_lease_seconds: int,
        expected_user_id: str,
        expected_song_document_id: str,
    ) -> bool:
        """Compare-and-swap claim of a job for this worker.

        Two safe-claim paths (ADR 0008):
        * ``status = 'queued'`` -- first delivery for this job. Easy case.
        * ``status = 'processing'`` AND
          ``lease_renewed_at < now() - stale_lease_seconds`` -- the
          previous worker is presumed dead (no heartbeat). Taking over is
          safe because the dead worker can no longer commit.

        Anything else (e.g. an active processor heartbeating fine, or the
        job already terminal) makes us return False; the caller then
        archives the redelivered queue message and skips. This prevents
        concurrent processors on the same job (Phase 4 adversarial review
        finding "CAS allows takeover from processing").

        We additionally bind the claim to the queue message's
        ``user_id`` / ``song_document_id`` so a forged or stale message
        cannot drive a job row that belongs to a different user / doc
        (Phase 4 adversarial review finding "Queue payload trust
        boundary").
        """
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.jobs
                set status = 'processing',
                    started_at = coalesce(started_at, now()),
                    last_attempt_at = now(),
                    lease_renewed_at = now(),
                    attempts = attempts + 1,
                    attempt_id = %s,
                    trace_id = %s
                where id = %s
                  and user_id = %s
                  and song_document_id = %s
                  and (
                    status = 'queued'
                    or (
                      status = 'processing'
                      and lease_renewed_at is not null
                      and lease_renewed_at < now() - make_interval(secs => %s)
                    )
                  )
                returning id;
                """,
                (
                    attempt_id,
                    trace_id,
                    job_id,
                    expected_user_id,
                    expected_song_document_id,
                    stale_lease_seconds,
                ),
            )
            return cur.fetchone() is not None

    def renew_lease(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        job_id: str,
    ) -> None:
        with conn.cursor() as cur:
            cur.execute(
                "update public.jobs set lease_renewed_at = now() where id = %s;",
                (job_id,),
            )

    def queue_lag_seconds(
        self,
        conn: psycopg.Connection[dict[str, Any]],
    ) -> float | None:
        """Return the age (seconds) of the oldest queued job.

        Used by Sprint 7's Prometheus exporter so the dashboard can
        show queue pressure. Returns ``None`` when the queue is empty.
        """
        with conn.cursor() as cur:
            cur.execute(
                """
                select extract(epoch from (now() - min(created_at)))::float as lag
                  from public.jobs
                 where status = 'queued'
                """,
            )
            row = cur.fetchone()
            if not row or row.get("lag") is None:
                return None
            return float(row["lag"])

    def insert_track(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        job_id: str,
        attempt_id: str,
        url: str,
        duration_seconds: int,
        format_: str,
        bytes_: int | None = None,
        expires_at: str | None = None,
        *,
        candidate_index: int = 0,
        is_current: bool = True,
    ) -> None:
        """Insert one row into public.tracks.

        Schema notes (migration 0041):
          - The legacy unique constraint on ``(job_id, attempt_id)`` was
            dropped in favour of a unique index on
            ``(job_id, attempt_id, candidate_index)`` so a single attempt
            can persist multiple candidate renders.
          - A partial unique index enforces "exactly one row per job has
            ``is_current = true``". For top-N jobs the worker therefore
            inserts every candidate with ``is_current=false`` first, then
            calls :meth:`set_current_track` to flip the reranker's winner.
        """
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.tracks
                  (job_id, attempt_id, url, duration_seconds, format, bytes,
                   expires_at, candidate_index, is_current)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (job_id, attempt_id, candidate_index) do nothing;
                """,
                (
                    job_id,
                    attempt_id,
                    url,
                    duration_seconds,
                    format_,
                    bytes_,
                    expires_at,
                    candidate_index,
                    is_current,
                ),
            )

    def set_current_track(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        *,
        job_id: str,
        attempt_id: str,
        candidate_index: int,
    ) -> None:
        """Flip the partial-unique `is_current=true` flag onto one candidate.

        Two statements share the caller's transaction (the partial unique
        index permits two rows with ``is_current=false`` but at most one
        with ``is_current=true``, so we must clear the old current row
        before flipping the new one).
        """
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.tracks
                   set is_current = false
                 where job_id = %s
                   and is_current = true
                   and not (attempt_id = %s and candidate_index = %s);
                """,
                (job_id, attempt_id, candidate_index),
            )
            cur.execute(
                """
                update public.tracks
                   set is_current = true
                 where job_id = %s
                   and attempt_id = %s
                   and candidate_index = %s;
                """,
                (job_id, attempt_id, candidate_index),
            )

    def mark_completed(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        job_id: str,
    ) -> None:
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.jobs
                set status = 'completed',
                    progress = 1.0,
                    finished_at = now(),
                    error = null
                where id = %s and status = 'processing';
                """,
                (job_id,),
            )

    def mark_failed(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        job_id: str,
        error: str,
    ) -> None:
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.jobs
                set status = 'failed',
                    finished_at = now(),
                    error = %s
                where id = %s and status in ('queued','processing');
                """,
                (error, job_id),
            )

    def update_progress(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        job_id: str,
        progress: float,
    ) -> None:
        with conn.cursor() as cur:
            cur.execute(
                "update public.jobs set progress = %s where id = %s;",
                (progress, job_id),
            )

    # ----- cover-art (v1.3 Sprint 3) -------------------------------------

    def update_cover_art_attempt(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        *,
        job_id: str,
        attempt_id: str,
        status: str,
        error: str | None = None,
        storage_path: str | None = None,
        model_version: str | None = None,
    ) -> None:
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.cover_art_attempts
                   set status = %s,
                       error = coalesce(%s, error),
                       storage_path = coalesce(%s, storage_path),
                       model_version = coalesce(%s, model_version)
                 where job_id = %s and attempt_id = %s
                """,
                (status, error, storage_path, model_version, job_id, attempt_id),
            )

    def flip_current_cover_art(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        *,
        job_id: str,
        storage_url: str,
        prompt: str,
        model_version: str | None,
    ) -> None:
        """Within ONE transaction: flip prior is_current=true rows for this
        song to false, then insert a new is_current=true artefact row.

        The two writes share the connection's implicit transaction; the
        caller passes a `conn` that was opened by `db.connect()`.
        """
        with conn.cursor() as cur:
            cur.execute(
                "update public.cover_art set is_current = false "
                "where job_id = %s and is_current = true;",
                (job_id,),
            )
            cur.execute(
                """
                insert into public.cover_art
                  (job_id, prompt, url, model_version, is_current)
                values (%s, %s, %s, %s, true);
                """,
                (job_id, prompt, storage_url, model_version),
            )
