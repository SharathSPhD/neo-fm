"""End-to-end coverage of the v1.4 Sprint 16 top-N candidate path.

The pipeline change under test:

  1. The queue message arrives with ``top_n_candidates > 1``.
  2. The worker calls ``inference.generate`` N times — once per candidate
     — and each call carries a deterministic ``seed`` derived from
     ``(trace_id, candidate_index)``.
  3. The worker mixes each instrumental against the same vocal / stem
     track, uploads N WAV files to storage at distinct candidate paths,
     and inserts N ``tracks`` rows. Exactly one row has
     ``is_current=true`` (the reranker's winner); the others are kept
     reachable for the /compare page.
  4. Storage paths follow the ``<job>/<attempt>__c<k>.wav`` convention
     for ``k > 0`` and the legacy ``<job>/<attempt>.wav`` for ``k = 0``,
     so the RLS policy on ``storage.objects`` (which only inspects the
     ``<job>`` folder) still authorises every read.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from app.config import Settings
from app.worker import JobOutcome, _candidate_seed, process_one

from .fakes import (
    FakeInferenceClient,
    FakeJob,
    FakeStorageClient,
    FakeWorkerDB,
    _tiny_valid_wav,
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
        governor_state_path=Path("/tmp/neo-fm-governor-disabled.state"),
        governor_poll_seconds=0.01,
        metrics_port=0,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


def _seed(db: FakeWorkerDB, *, message: dict[str, object]) -> int:
    job_id = str(message["job_id"])
    user_id = str(message["user_id"])
    song_id = str(message["song_document_id"])
    db.jobs[job_id] = FakeJob(user_id=user_id, song_document_id=song_id)
    db.song_documents[song_id] = make_song_document()
    return db.enqueue(message)


def test_candidate_seed_is_deterministic_and_per_index() -> None:
    """Same (trace_id, k) -> same seed; different k -> different seed."""
    seed_0a = _candidate_seed("trace-zzz", 0)
    seed_0b = _candidate_seed("trace-zzz", 0)
    seed_1 = _candidate_seed("trace-zzz", 1)
    seed_2 = _candidate_seed("trace-zzz", 2)

    assert seed_0a == seed_0b
    assert seed_0a != seed_1
    assert seed_1 != seed_2
    # 32-bit unsigned: must fit in a numpy seeder.
    for seed in (seed_0a, seed_1, seed_2):
        assert 0 <= seed < 2**32


async def test_top_n_persists_every_candidate_with_one_is_current() -> None:
    """N=3 should produce 3 inference calls, 3 storage uploads, 3 tracks,
    and exactly one row with ``is_current=true``."""
    db = FakeWorkerDB()
    # Three distinct WAVs so the reranker has different feature vectors
    # to score (the bench_dispatch deterministic head hashes the path
    # string, so distinct storage paths is what matters in CI; here we
    # also vary the bytes for realism).
    wav_a = _tiny_valid_wav(seconds=0.1)
    wav_b = _tiny_valid_wav(seconds=0.15)
    wav_c = _tiny_valid_wav(seconds=0.2)
    inference = FakeInferenceClient(responses=[wav_a, wav_b, wav_c])
    storage = FakeStorageClient()
    msg = {**make_message(), "top_n_candidates": 3}
    msg_id = _seed(db, message=msg)

    outcome = await process_one(
        settings=_settings(),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    assert outcome == JobOutcome.COMPLETED

    # 3 inference calls, each carrying candidate_index + seed
    assert len(inference.calls) == 3
    seen_indices = sorted(
        call["request"]["candidate_index"] for call in inference.calls
    )
    assert seen_indices == [0, 1, 2]
    # Each seed is the deterministic hash of (trace_id, candidate_index).
    for call in inference.calls:
        idx = call["request"]["candidate_index"]
        assert call["request"]["seed"] == _candidate_seed(
            msg["trace_id"], idx,  # type: ignore[arg-type]
        )

    # 3 storage uploads, candidate_index 0 keeps the legacy path so
    # the storage.objects RLS policy still authorises by job folder.
    paths = sorted(u[0] for u in storage.uploads)
    assert paths == [
        f"{msg['job_id']}/{msg['attempt_id']}.wav",
        f"{msg['job_id']}/{msg['attempt_id']}__c1.wav",
        f"{msg['job_id']}/{msg['attempt_id']}__c2.wav",
    ]

    # 3 tracks rows; exactly one has is_current=true.
    job_tracks = [t for t in db.tracks if t.job_id == str(msg["job_id"])]
    assert len(job_tracks) == 3
    currents = [t for t in job_tracks if t.is_current]
    assert len(currents) == 1
    assert currents[0].candidate_index in {0, 1, 2}

    # The job is completed and the queue message is archived.
    assert db.jobs[str(msg["job_id"])].status == "completed"
    assert db.queue[0].archived is True


async def test_top_n_replay_is_idempotent_no_duplicate_candidate_rows() -> None:
    """Redelivery with the same attempt_id must not double-insert any candidate."""
    db = FakeWorkerDB()
    inference = FakeInferenceClient(
        responses=[_tiny_valid_wav(), _tiny_valid_wav()],
    )
    storage = FakeStorageClient()
    msg = {**make_message(), "top_n_candidates": 2}
    msg_id = _seed(db, message=msg)

    await process_one(
        settings=_settings(),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    # Replay the same message; the job is now `completed`, so the
    # CAS rejects the second worker and no new tracks are inserted.
    msg_id2 = db.enqueue(msg)
    outcome = await process_one(
        settings=_settings(),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id2, "message": msg},
    )

    assert outcome == JobOutcome.COMPLETED
    # Still only N=2 tracks for this job.
    job_tracks = [t for t in db.tracks if t.job_id == str(msg["job_id"])]
    assert len(job_tracks) == 2
    # And only one current.
    currents = [t for t in job_tracks if t.is_current]
    assert len(currents) == 1


async def test_top_n_one_falls_through_to_legacy_path() -> None:
    """N=1 (the default) must not carry candidate_index/seed and must keep
    writing to the legacy storage path so older signed-URL flows keep
    resolving."""
    db = FakeWorkerDB()
    inference = FakeInferenceClient()
    storage = FakeStorageClient()
    msg = make_message()  # top_n_candidates defaults to 1
    msg_id = _seed(db, message=msg)

    outcome = await process_one(
        settings=_settings(),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
    )

    assert outcome == JobOutcome.COMPLETED
    assert len(inference.calls) == 1
    request = inference.calls[0]["request"]
    assert "candidate_index" not in request
    assert "seed" not in request
    assert len(storage.uploads) == 1
    assert storage.uploads[0][0] == f"{msg['job_id']}/{msg['attempt_id']}.wav"
    job_tracks = [t for t in db.tracks if t.job_id == str(msg["job_id"])]
    assert len(job_tracks) == 1
    assert job_tracks[0].candidate_index == 0
    assert job_tracks[0].is_current is True
