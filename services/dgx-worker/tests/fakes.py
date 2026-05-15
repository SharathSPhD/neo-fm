"""In-memory fakes for unit-testing worker.py end-to-end.

The fakes are intentionally small. They imitate the public surface of
WorkerDB and StorageClient just enough to drive `process_one` through its
happy and unhappy paths without touching Postgres or HTTP.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

from app.models import SongDocument


@dataclass
class FakeJob:
    user_id: str
    song_document_id: str
    status: str = "queued"
    attempts: int = 0
    attempt_id: str | None = None
    trace_id: str | None = None
    error: str | None = None
    progress: float = 0.0
    started_at: object | None = None
    finished_at: object | None = None
    lease_renewed_at: object | None = None


@dataclass
class FakeTrack:
    job_id: str
    attempt_id: str
    url: str
    duration_seconds: int
    format_: str
    bytes_: int | None


@dataclass
class FakeQueueMessage:
    msg_id: int
    payload: dict[str, Any]
    vt_extensions: int = 0
    archived: bool = False
    deleted: bool = False


@dataclass
class FakeWorkerDB:
    jobs: dict[str, FakeJob] = field(default_factory=dict)
    song_documents: dict[str, SongDocument] = field(default_factory=dict)
    queue: list[FakeQueueMessage] = field(default_factory=list)
    dlq: list[dict[str, Any]] = field(default_factory=list)
    tracks: list[FakeTrack] = field(default_factory=list)
    heartbeats: list[tuple[int, str]] = field(default_factory=list)
    next_msg_id: int = 1

    @contextmanager
    def connect(self) -> Iterator[FakeWorkerDB]:
        yield self

    def enqueue(self, payload: dict[str, Any]) -> int:
        msg_id = self.next_msg_id
        self.next_msg_id += 1
        self.queue.append(FakeQueueMessage(msg_id=msg_id, payload=payload))
        return msg_id

    def read_one(self, _conn: Any, _queue_name: str, _vt: int) -> dict[str, Any] | None:
        for msg in self.queue:
            if msg.archived or msg.deleted:
                continue
            return {"msg_id": msg.msg_id, "message": msg.payload}
        return None

    def set_visibility_timeout(self, _conn: Any, _queue: str, msg_id: int, vt: int) -> None:
        for msg in self.queue:
            if msg.msg_id == msg_id:
                msg.vt_extensions += 1
        self.heartbeats.append((msg_id, "vt"))

    def archive(self, _conn: Any, _queue: str, msg_id: int) -> None:
        for msg in self.queue:
            if msg.msg_id == msg_id:
                msg.archived = True

    def delete(self, _conn: Any, _queue: str, msg_id: int) -> None:
        for msg in self.queue:
            if msg.msg_id == msg_id:
                msg.deleted = True

    def send_to_dlq(self, _conn: Any, _dlq: str, payload: dict[str, Any]) -> int:
        self.dlq.append(payload)
        return len(self.dlq)

    def reenqueue(self, _conn: Any, _queue: str, payload: dict[str, Any]) -> int:
        return self.enqueue(payload)

    def fetch_song_document(self, _conn: Any, song_document_id: str) -> SongDocument:
        if song_document_id not in self.song_documents:
            raise LookupError(f"song_document {song_document_id} not found")
        return self.song_documents[song_document_id]

    def claim_job_processing(
        self,
        _conn: Any,
        job_id: str,
        attempt_id: str,
        trace_id: str,
        *,
        stale_lease_seconds: int,
        expected_user_id: str,
        expected_song_document_id: str,
    ) -> bool:
        """Mirror the real CAS rules so unit tests catch the same races
        the production query is hardened against."""
        import time as _time

        job = self.jobs.get(job_id)
        if job is None:
            return False
        if job.user_id != expected_user_id:
            return False
        if job.song_document_id != expected_song_document_id:
            return False
        # First delivery: queued -> processing.
        if job.status == "queued":
            ok = True
        # Stale takeover: only if the previous worker stopped heartbeating.
        elif job.status == "processing":
            last = getattr(job, "_lease_renewed_at_epoch", None)
            ok = last is not None and (_time.time() - last) > stale_lease_seconds
        else:
            ok = False
        if not ok:
            return False
        job.status = "processing"
        job.attempts += 1
        job.attempt_id = attempt_id
        job.trace_id = trace_id
        job.started_at = job.started_at or "now"
        job.lease_renewed_at = "now"
        job._lease_renewed_at_epoch = _time.time()  # type: ignore[attr-defined]
        return True

    def renew_lease(self, _conn: Any, job_id: str) -> None:
        import time as _time

        if job_id in self.jobs:
            job = self.jobs[job_id]
            job.lease_renewed_at = "now"
            job._lease_renewed_at_epoch = _time.time()  # type: ignore[attr-defined]
            self.heartbeats.append((-1, job_id))

    def insert_track(
        self,
        _conn: Any,
        *,
        job_id: str,
        attempt_id: str,
        url: str,
        duration_seconds: int,
        format_: str,
        bytes_: int | None = None,
        expires_at: str | None = None,
    ) -> None:
        for t in self.tracks:
            if t.job_id == job_id and t.attempt_id == attempt_id:
                return
        self.tracks.append(
            FakeTrack(
                job_id=job_id,
                attempt_id=attempt_id,
                url=url,
                duration_seconds=duration_seconds,
                format_=format_,
                bytes_=bytes_,
            ),
        )

    def mark_completed(self, _conn: Any, job_id: str) -> None:
        job = self.jobs.get(job_id)
        if job and job.status == "processing":
            job.status = "completed"
            job.progress = 1.0
            job.finished_at = "now"
            job.error = None

    def mark_failed(self, _conn: Any, job_id: str, error: str) -> None:
        job = self.jobs.get(job_id)
        if job and job.status in ("queued", "processing"):
            job.status = "failed"
            job.finished_at = "now"
            job.error = error

    def update_progress(self, _conn: Any, job_id: str, progress: float) -> None:
        if job_id in self.jobs:
            self.jobs[job_id].progress = progress


@dataclass
class FakeStorageClient:
    uploads: list[tuple[str, bytes, str]] = field(default_factory=list)
    fail_on_upload: bool = False
    bucket: str = "tracks"

    def object_path(self, job_id: str, attempt_id: str, ext: str) -> str:
        return f"{job_id}/{attempt_id}.{ext}"

    def storage_url(self, object_path: str) -> str:
        return f"{self.bucket}/{object_path}"

    async def put_object(self, *, object_path: str, content: bytes, content_type: str) -> None:
        if self.fail_on_upload:
            raise RuntimeError("storage upload boom")
        self.uploads.append((object_path, content, content_type))

    async def aclose(self) -> None:
        return None


def _tiny_valid_wav(seconds: float = 0.1, sr: int = 24000) -> bytes:
    """Produce a tiny but valid 16-bit PCM mono WAV for tests.

    The dgx-worker now mixes through `mixer.mix_to_stereo_48k`, which
    requires a real WAV (it decodes via soundfile). The historical
    sentinel of ``b"WAVDATA"`` predates that step; the canonical fake
    now produces a real (silent) WAV so the entire happy path works.
    """
    import io as _io
    import struct as _s

    n = int(seconds * sr)
    pcm = b"\x00\x00" * n
    chunk_size = 36 + len(pcm)
    return (
        b"RIFF"
        + _s.pack("<I", chunk_size)
        + b"WAVEfmt "
        + _s.pack("<I", 16)
        + _s.pack("<H", 1)
        + _s.pack("<H", 1)
        + _s.pack("<I", sr)
        + _s.pack("<I", sr * 2)
        + _s.pack("<H", 2)
        + _s.pack("<H", 16)
        + b"data"
        + _s.pack("<I", len(pcm))
        + pcm
    )


_DEFAULT_FAKE_WAV = _tiny_valid_wav()


class FakeInferenceClient:
    def __init__(
        self,
        *,
        response: bytes = _DEFAULT_FAKE_WAV,
        exc: Exception | None = None,
    ) -> None:
        self.response = response
        self.exc = exc
        self.calls: list[dict[str, Any]] = []

    async def generate(self, *, request_body: dict[str, Any], trace_id: str) -> bytes:
        self.calls.append({"request": request_body, "trace_id": trace_id})
        if self.exc is not None:
            raise self.exc
        return self.response

    async def aclose(self) -> None:
        return None


class FakeVocalClient:
    """Mirror of `FakeInferenceClient` but for vocal-synth.

    Sprint 5 worker tests use this when they want to exercise the
    vocal-mix codepath without standing up a real vocal-synth service.
    """

    def __init__(
        self,
        *,
        response: bytes = _DEFAULT_FAKE_WAV,
        exc: Exception | None = None,
    ) -> None:
        self.response = response
        self.exc = exc
        self.calls: list[dict[str, Any]] = []

    async def vocalize(self, *, request_body: dict[str, Any], trace_id: str) -> bytes:
        self.calls.append({"request": request_body, "trace_id": trace_id})
        if self.exc is not None:
            raise self.exc
        return self.response

    async def aclose(self) -> None:
        return None


def make_message(
    *,
    job_id: str = "11111111-1111-1111-1111-111111111111",
    user_id: str = "22222222-2222-2222-2222-222222222222",
    song_document_id: str = "33333333-3333-3333-3333-333333333333",
    attempt_id: str = "44444444-4444-4444-4444-444444444444",
    attempt_number: int = 1,
) -> dict[str, Any]:
    return {
        "job_id": job_id,
        "user_id": user_id,
        "song_document_id": song_document_id,
        "priority": "normal",
        "created_at": "2026-05-13T20:00:00Z",
        "style_family": "carnatic",
        "target_duration_seconds": 60,
        "tier": "creator",
        "attempt_id": attempt_id,
        "attempt_number": attempt_number,
        "trace_id": "trace-abc",
    }


def make_song_document() -> SongDocument:
    return SongDocument.model_validate(
        {
            "language": "kn",
            "style_family": "carnatic",
            "target_duration_seconds": 60,
            "sections": [
                {"id": "intro", "type": "intro", "target_seconds": 12},
                {"id": "verse", "type": "verse", "target_seconds": 36},
                {"id": "outro", "type": "outro", "target_seconds": 12},
            ],
        },
    )


def dump_request_body(request_body: dict[str, Any]) -> bytes:
    return json.dumps(request_body, separators=(",", ":")).encode()
