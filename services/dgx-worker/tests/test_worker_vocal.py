"""Sprint 5 — exercise the worker -> vocal-synth -> mixer chain.

These tests use the same in-memory fakes as the rest of the worker
suite plus a `FakeVocalClient`. The mixer runs for real (pure numpy).
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from app.config import Settings
from app.worker import JobOutcome, process_one

from .fakes import (
    FakeInferenceClient,
    FakeJob,
    FakeStorageClient,
    FakeVocalClient,
    FakeWorkerDB,
    make_message,
    make_song_document,
)


def _settings_with_vocals(*langs: str, **overrides: object) -> Settings:
    base = Settings(
        pg_dsn="postgres://test",
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="srk",
        storage_bucket="tracks",
        music_inference_url="https://inference.test",
        music_inference_hmac_secret="hmac",
        music_inference_timeout_seconds=10.0,
        vocal_synth_url="https://vocal-synth.test",
        vocal_synth_hmac_secret="vhmac",
        vocal_synth_timeout_seconds=10.0,
        vocal_languages=langs,
        vocal_voice_timbre="androgynous",
        queue_name="song_generation_jobs",
        dlq_name="song_generation_jobs_dlq",
        visibility_timeout_seconds=300,
        heartbeat_interval_seconds=60,
        poll_interval_seconds=0.1,
        max_attempts=3,
        governor_state_path=Path("/tmp/neo-fm-governor-vocal-disabled.state"),
        governor_poll_seconds=0.01,
        metrics_port=0,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_worker_calls_vocal_synth_for_each_configured_language() -> None:
    db = FakeWorkerDB()
    msg = make_message()
    job_id = str(msg["job_id"])
    db.jobs[job_id] = FakeJob(
        user_id=str(msg["user_id"]),
        song_document_id=str(msg["song_document_id"]),
    )
    db.song_documents[str(msg["song_document_id"])] = make_song_document()
    msg_id = db.enqueue(msg)

    inference = FakeInferenceClient()
    vocal = FakeVocalClient()
    storage = FakeStorageClient()

    outcome = await process_one(
        settings=_settings_with_vocals("hi", "kn"),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
        vocal=vocal,  # type: ignore[arg-type]
    )

    assert outcome == JobOutcome.COMPLETED
    # One inference call + one vocal call per language (parallel).
    assert len(inference.calls) == 1
    assert len(vocal.calls) == 2
    langs_called = {c["request"]["language"] for c in vocal.calls}
    assert langs_called == {"hi", "kn"}

    # Vocal request payloads carry section ids + raga (when available).
    for call in vocal.calls:
        body = call["request"]
        assert body["job_id"] == msg["job_id"]
        assert body["voice_timbre"] == "androgynous"
        assert body["sample_rate"] == 48000
        assert len(body["sections"]) >= 1

    # The uploaded WAV is the mixer's stereo 48k output, not the raw
    # inference bytes -- because vocals exist + mixer ran.
    assert len(storage.uploads) == 1
    _path, content, _ctype = storage.uploads[0]
    assert content[:4] == b"RIFF"
    assert content[8:12] == b"WAVE"


@pytest.mark.asyncio
async def test_vocal_lang_failure_does_not_abort_job() -> None:
    """A failure in one vocal language is logged but the job still
    completes with whatever languages succeeded.
    """
    db = FakeWorkerDB()
    msg = make_message()
    job_id = str(msg["job_id"])
    db.jobs[job_id] = FakeJob(
        user_id=str(msg["user_id"]),
        song_document_id=str(msg["song_document_id"]),
    )
    db.song_documents[str(msg["song_document_id"])] = make_song_document()
    msg_id = db.enqueue(msg)

    inference = FakeInferenceClient()
    # Single shared client whose `vocalize` always errors.
    failing_vocal = FakeVocalClient(exc=RuntimeError("vocal model down"))
    storage = FakeStorageClient()

    outcome = await process_one(
        settings=_settings_with_vocals("hi"),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
        vocal=failing_vocal,  # type: ignore[arg-type]
    )

    assert outcome == JobOutcome.COMPLETED
    # Even with vocal failures, the instrumental-only mix is uploaded.
    assert len(storage.uploads) == 1
    _path, content, _ = storage.uploads[0]
    assert content[:4] == b"RIFF"


@pytest.mark.asyncio
async def test_worker_forwards_section_phonemes_to_vocal_synth() -> None:
    """v1.3 Sprint 4: when the co-composer (or a producer) populated
    `section.phonemes` on the Song Document, the worker must forward
    them into the `/v1/vocalize` payload. The vocal-synth router then
    feeds them into the chosen backend.
    """
    from app.models import SongDocument  # local import: heavy module

    db = FakeWorkerDB()
    msg = make_message()
    job_id = str(msg["job_id"])
    db.jobs[job_id] = FakeJob(
        user_id=str(msg["user_id"]),
        song_document_id=str(msg["song_document_id"]),
    )
    db.song_documents[str(msg["song_document_id"])] = SongDocument.model_validate(
        {
            "language": "hi",
            "style_family": "hindustani",
            "target_duration_seconds": 30,
            "sections": [
                {
                    "id": "mukhda",
                    "type": "mukhda",
                    "lyrics": "नमस्कार",
                    "script": "devanagari",
                    "phonemes": ["n", "a", "m", "a", "s", "k", "aa", "r"],
                    "target_seconds": 30,
                },
            ],
        },
    )
    msg_id = db.enqueue(msg)

    inference = FakeInferenceClient()
    vocal = FakeVocalClient()
    storage = FakeStorageClient()

    outcome = await process_one(
        settings=_settings_with_vocals("hi"),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
        vocal=vocal,  # type: ignore[arg-type]
    )

    assert outcome == JobOutcome.COMPLETED
    assert len(vocal.calls) == 1
    body = vocal.calls[0]["request"]
    section_payload = body["sections"][0]
    assert section_payload["phonemes"] == [
        "n",
        "a",
        "m",
        "a",
        "s",
        "k",
        "aa",
        "r",
    ]


@pytest.mark.asyncio
async def test_worker_forwards_document_voice_id_to_vocal_synth() -> None:
    """v1.4 Sprint 5: the SongDocument-level `voice_id` (set from the
    voice picker on the creation canvas) flows through to the
    /v1/vocalize body so the router can swap in the catalogue prompt.
    """
    from app.models import SongDocument  # local import: heavy module

    db = FakeWorkerDB()
    msg = make_message()
    job_id = str(msg["job_id"])
    db.jobs[job_id] = FakeJob(
        user_id=str(msg["user_id"]),
        song_document_id=str(msg["song_document_id"]),
    )
    db.song_documents[str(msg["song_document_id"])] = SongDocument.model_validate(
        {
            "language": "kn",
            "style_family": "kannada-light-classical",
            "target_duration_seconds": 30,
            "voice_id": "indic_kn_female_bhajan",
            "sections": [
                {
                    "id": "verse",
                    "type": "verse",
                    "lyrics": "ಕನ್ನಡ ಭಾವಗೀತೆ",
                    "script": "kannada",
                    "target_seconds": 30,
                },
            ],
        },
    )
    msg_id = db.enqueue(msg)

    inference = FakeInferenceClient()
    vocal = FakeVocalClient()
    storage = FakeStorageClient()

    outcome = await process_one(
        settings=_settings_with_vocals("kn"),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
        vocal=vocal,  # type: ignore[arg-type]
    )

    assert outcome == JobOutcome.COMPLETED
    assert len(vocal.calls) == 1
    body = vocal.calls[0]["request"]
    assert body["voice_id"] == "indic_kn_female_bhajan"
    # Per-section override defaults to None when the document only
    # carries a top-level voice_id.
    assert body["sections"][0]["voice_id"] is None


@pytest.mark.asyncio
async def test_worker_skips_vocal_synth_when_no_languages_configured() -> None:
    db = FakeWorkerDB()
    msg = make_message()
    job_id = str(msg["job_id"])
    db.jobs[job_id] = FakeJob(
        user_id=str(msg["user_id"]),
        song_document_id=str(msg["song_document_id"]),
    )
    db.song_documents[str(msg["song_document_id"])] = make_song_document()
    msg_id = db.enqueue(msg)

    inference = FakeInferenceClient()
    vocal = FakeVocalClient()
    storage = FakeStorageClient()

    outcome = await process_one(
        settings=_settings_with_vocals(),
        db=db,  # type: ignore[arg-type]
        inference=inference,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        queue_msg={"msg_id": msg_id, "message": msg},
        vocal=vocal,  # type: ignore[arg-type]
    )

    assert outcome == JobOutcome.COMPLETED
    assert vocal.calls == []
