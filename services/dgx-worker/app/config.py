"""Worker configuration loaded from environment variables.

All required env vars come from the DGX-side `.env` file. The container
fails fast at boot if anything is missing -- no surprise NULLs at job time.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"Missing required env var {name}. "
            "Set it in the DGX-side .env loaded by docker-compose."
        )
    return value


@dataclass(frozen=True)
class Settings:
    # Postgres connection for the worker. Connects as neo_fm_worker (ADR 0004).
    pg_dsn: str

    # Supabase Storage (private bucket `tracks`). Service-role key is used
    # *only* for storage uploads; SQL goes through neo_fm_worker.
    supabase_url: str
    supabase_service_role_key: str
    storage_bucket: str

    # Music-inference HTTP client config (ADR 0003).
    music_inference_url: str
    music_inference_hmac_secret: str
    music_inference_timeout_seconds: float

    # Queue tuning (ADR 0008).
    queue_name: str
    dlq_name: str
    visibility_timeout_seconds: int
    heartbeat_interval_seconds: int
    poll_interval_seconds: float
    max_attempts: int


def load_settings() -> Settings:
    return Settings(
        pg_dsn=_required("PG_DSN"),
        supabase_url=_required("SUPABASE_URL"),
        supabase_service_role_key=_required("SUPABASE_SERVICE_ROLE_KEY"),
        storage_bucket=os.environ.get("STORAGE_BUCKET", "tracks"),
        music_inference_url=_required("MUSIC_INFERENCE_URL"),
        music_inference_hmac_secret=_required("MUSIC_INFERENCE_HMAC_SECRET"),
        music_inference_timeout_seconds=float(
            os.environ.get("MUSIC_INFERENCE_TIMEOUT_SECONDS", "600"),
        ),
        queue_name=os.environ.get("QUEUE_NAME", "song_generation_jobs"),
        dlq_name=os.environ.get("DLQ_NAME", "song_generation_jobs_dlq"),
        visibility_timeout_seconds=int(
            os.environ.get("VISIBILITY_TIMEOUT_SECONDS", "300"),
        ),
        heartbeat_interval_seconds=int(
            os.environ.get("HEARTBEAT_INTERVAL_SECONDS", "60"),
        ),
        poll_interval_seconds=float(os.environ.get("POLL_INTERVAL_SECONDS", "5")),
        max_attempts=int(os.environ.get("MAX_ATTEMPTS", "3")),
    )
