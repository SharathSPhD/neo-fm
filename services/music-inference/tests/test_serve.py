"""Tests for the music-inference HTTP surface (Phase 1).

We don't run torch or heartlib here. The `client` fixture installs a
`FakeMusicModel` and skips the lifespan-event model load, so every
test exercises the same code paths the real DGX container will, minus
the actual GPU inference."""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import time
import wave
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app import model as model_module
from app.model import FakeMusicModel
from app.serve import app

TEST_SECRET = "test-secret-do-not-use-in-production-32bytes"


@pytest.fixture()
def fake_model() -> Iterator[FakeMusicModel]:
    """Pin a FakeMusicModel as the active model for the duration of one test."""
    m = FakeMusicModel()
    model_module.set_active_model(m)
    try:
        yield m
    finally:
        model_module.set_active_model(None)


@pytest.fixture()
def client(
    monkeypatch: pytest.MonkeyPatch,
    fake_model: FakeMusicModel,
) -> TestClient:
    monkeypatch.setenv("MUSIC_INFERENCE_HMAC_SECRET", TEST_SECRET)
    monkeypatch.setenv("MUSIC_INFERENCE_SKIP_LIFESPAN", "1")
    return TestClient(app)


def _sign(body: bytes, ts: str, secret: str = TEST_SECRET) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        body + b"\n" + ts.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()


def _signed_post(
    client: TestClient,
    payload: dict[str, Any],
    *,
    signature_override: str | None = None,
    timestamp_offset_seconds: int = 0,
) -> httpx.Response:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ts = str(int(time.time()) + timestamp_offset_seconds)
    return client.post(
        "/v1/generate",
        content=body,
        headers={
            "content-type": "application/json",
            "x-neofm-timestamp": ts,
            "x-neofm-signature": signature_override or _sign(body, ts),
        },
    )


SECTIONS: list[dict[str, Any]] = [
    {
        "id": "s1",
        "type": "intro",
        "target_seconds": 8,
    },
    {
        "id": "s2",
        "type": "verse",
        "target_seconds": 22,
        "lyrics": "Walking down the street",
        "language": "en",
    },
]
BASE_PAYLOAD: dict[str, Any] = {
    "job_id": "00000000-0000-0000-0000-000000000000",
    "style_family": "western",
    "target_duration_seconds": 30,
    "sections": SECTIONS,
}


# --- healthz --------------------------------------------------------------


def test_healthz_unauthenticated_and_reports_phase_1(client: TestClient) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is True
    assert body["model_version"] == "fake-1.0"
    assert body["phase"] == 1


def test_healthz_reports_degraded_when_no_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """If the model failed to load, /healthz must say so rather than
    masking it with a false 'ok'."""
    monkeypatch.setenv("MUSIC_INFERENCE_HMAC_SECRET", TEST_SECRET)
    monkeypatch.setenv("MUSIC_INFERENCE_SKIP_LIFESPAN", "1")
    model_module.set_active_model(None)
    with TestClient(app) as c:
        r = c.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["model_loaded"] is False
    # A None model reads as "ok" (we don't know what's running). The
    # degraded state is reserved for a model that *is* installed but
    # not loaded -- e.g. weights are still downloading.
    assert body["status"] == "ok"


# --- HMAC -----------------------------------------------------------------


def test_generate_without_hmac_is_401(client: TestClient) -> None:
    r = client.post("/v1/generate", json=BASE_PAYLOAD)
    assert r.status_code == 401


def test_generate_rejects_stale_timestamp(client: TestClient) -> None:
    r = _signed_post(client, BASE_PAYLOAD, timestamp_offset_seconds=-3600)
    assert r.status_code == 401


def test_generate_rejects_wrong_signature(client: TestClient) -> None:
    r = _signed_post(client, BASE_PAYLOAD, signature_override="deadbeef" * 8)
    assert r.status_code == 401


def test_generate_rejects_invalid_target_seconds(client: TestClient) -> None:
    bad = {
        **BASE_PAYLOAD,
        "sections": [{"id": "s1", "type": "intro", "target_seconds": 9999}],
    }
    r = _signed_post(client, bad)
    assert r.status_code == 422


# --- happy path -----------------------------------------------------------


def test_generate_happy_path_returns_wav_bytes(
    client: TestClient, fake_model: FakeMusicModel
) -> None:
    r = _signed_post(client, BASE_PAYLOAD)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "audio/wav"
    assert r.headers["X-NeoFM-Model-Version"] == "fake-1.0"
    assert r.headers["X-NeoFM-Job-Id"] == BASE_PAYLOAD["job_id"]
    # the body must be a real WAV the worker can hand straight to storage
    with wave.open(io.BytesIO(r.content)) as w:
        assert w.getnchannels() == 1
        assert w.getsampwidth() == 2
        assert w.getframerate() == 48000


def test_generate_returns_503_when_model_unloaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MUSIC_INFERENCE_HMAC_SECRET", TEST_SECRET)
    monkeypatch.setenv("MUSIC_INFERENCE_SKIP_LIFESPAN", "1")
    model_module.set_active_model(None)
    with TestClient(app) as c:
        body = json.dumps(BASE_PAYLOAD, separators=(",", ":")).encode("utf-8")
        ts = str(int(time.time()))
        r = c.post(
            "/v1/generate",
            content=body,
            headers={
                "content-type": "application/json",
                "x-neofm-timestamp": ts,
                "x-neofm-signature": _sign(body, ts),
            },
        )
    assert r.status_code == 503
    assert r.json()["detail"]["error"] == "model_not_loaded"


# --- request → lyrics/tags translation ------------------------------------


def test_generate_invokes_model_with_translated_lyrics_and_tags(
    client: TestClient, fake_model: FakeMusicModel
) -> None:
    payload = {
        **BASE_PAYLOAD,
        "sections": [
            {
                "id": "s1",
                "type": "intro",
                "target_seconds": 8,
                "tags": ["piano"],
            },
            {
                "id": "s2",
                "type": "verse",
                "target_seconds": 22,
                "lyrics": "Walking down the street",
                "language": "en",
                "tags": ["warm"],
            },
            {
                "id": "s3",
                "type": "chorus",
                "target_seconds": 30,
                "lyrics": "Every day the light returns",
                "tags": ["uplifting"],
            },
        ],
    }
    r = _signed_post(client, payload)
    assert r.status_code == 200, r.text

    # the FakeMusicModel records exactly what the model layer saw, so we
    # can assert the lyrics block + tag union arrived in the format
    # heartlib expects.
    assert fake_model.last_lyrics is not None
    assert fake_model.last_lyrics.startswith("[Intro]")
    assert "[Verse]\nWalking down the street" in fake_model.last_lyrics
    assert "[Chorus]\nEvery day the light returns" in fake_model.last_lyrics

    # tags: style family seed + per-section tags, deduped, comma-joined.
    assert fake_model.last_tags is not None
    parts = fake_model.last_tags.split(",")
    assert parts[0] == "pop"  # style_family=western seed
    assert "piano" in parts
    assert "warm" in parts
    assert "uplifting" in parts
    # dedupe order: every tag appears at most once.
    assert len(parts) == len(set(parts))


def test_generate_uses_transliteration_for_indic_sections(
    client: TestClient, fake_model: FakeMusicModel
) -> None:
    """Phase 3 lyrics provider supplies both Devanagari text and a
    Latin-script transliteration. HeartMuLa was trained on Latin-script
    inputs so we must pass the transliteration."""
    payload = {
        "job_id": "00000000-0000-0000-0000-000000000001",
        "style_family": "hindustani",
        "target_duration_seconds": 60,
        "sections": [
            {
                "id": "s1",
                "type": "verse",
                "target_seconds": 60,
                "lyrics": "पोथी पढि पढि जग मुआ",
                "transliteration": "Pothi padhi padhi jag mua",
                "language": "hi",
            },
        ],
    }
    r = _signed_post(client, payload)
    assert r.status_code == 200, r.text
    assert "Pothi padhi padhi jag mua" in (fake_model.last_lyrics or "")
    # the Devanagari source should *not* leak through when the
    # transliteration is present.
    assert "पोथी" not in (fake_model.last_lyrics or "")
    # tag prefix reflects style_family=hindustani
    tags = (fake_model.last_tags or "").split(",")
    assert tags[0] == "hindustani"
