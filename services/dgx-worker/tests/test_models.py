"""Pydantic model contract tests."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models import QueueMessage, SongDocument


def test_queue_message_rejects_unknown_fields() -> None:
    payload = {
        "job_id": "11111111-1111-1111-1111-111111111111",
        "user_id": "22222222-2222-2222-2222-222222222222",
        "song_document_id": "33333333-3333-3333-3333-333333333333",
        "priority": "normal",
        "created_at": "2026-05-13T20:00:00Z",
        "style_family": "carnatic",
        "target_duration_seconds": 60,
        "attempt_id": "44444444-4444-4444-4444-444444444444",
        "attempt_number": 1,
        "trace_id": "abc",
        "rogue": True,
    }
    with pytest.raises(ValidationError):
        QueueMessage.model_validate(payload)


def test_queue_message_target_duration_must_be_allowed() -> None:
    payload = {
        "job_id": "11111111-1111-1111-1111-111111111111",
        "user_id": "22222222-2222-2222-2222-222222222222",
        "song_document_id": "33333333-3333-3333-3333-333333333333",
        "created_at": "2026-05-13T20:00:00Z",
        "style_family": "western",
        "target_duration_seconds": 45,
        "attempt_id": "44444444-4444-4444-4444-444444444444",
        "trace_id": "abc",
    }
    with pytest.raises(ValidationError):
        QueueMessage.model_validate(payload)


def test_song_document_minimum_shape() -> None:
    doc = SongDocument.model_validate(
        {
            "language": "kn",
            "style_family": "carnatic",
            "target_duration_seconds": 60,
            "sections": [
                {"id": "intro", "type": "intro", "target_seconds": 30},
                {"id": "outro", "type": "outro", "target_seconds": 30},
            ],
        },
    )
    assert doc.style_family == "carnatic"
    assert len(doc.sections) == 2
