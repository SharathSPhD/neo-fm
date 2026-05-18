"""Worker configuration loaded from environment variables.

All required env vars come from the DGX-side `.env` file. The container
fails fast at boot if anything is missing -- no surprise NULLs at job time.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


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

    # Optional vocal-synth (Sprint 5). When `vocal_synth_url` is empty
    # the worker skips vocals entirely and writes an instrumental-only
    # WAV; this is how local docker-compose without GPU keeps working.
    vocal_synth_url: str
    vocal_synth_hmac_secret: str
    vocal_synth_timeout_seconds: float
    # Comma-separated list of languages (BCP-47-ish: en/hi/kn/ta/te/bn).
    # When empty, no vocals are rendered even if URL is set.
    vocal_languages: tuple[str, ...]
    vocal_voice_timbre: str

    # Queue tuning (ADR 0008).
    queue_name: str
    dlq_name: str
    visibility_timeout_seconds: int
    heartbeat_interval_seconds: int
    poll_interval_seconds: float
    max_attempts: int

    # GPU governor coordination (ADR 0011).
    governor_state_path: Path
    governor_poll_seconds: float

    # Sprint 7 observability. 0 disables the embedded metrics HTTP server
    # (useful in tests / one-shot scripts).
    metrics_port: int

    # v1.3 Sprint 3 — cover-art sidecar (optional). Empty `cover_art_synth_url`
    # disables the cover-art consumer entirely; the Next.js layer falls
    # back to the gradient on `/songs/[id]` until a backend is configured.
    # Defaults keep older Settings(...) call sites (and the existing
    # song-render tests) working without forcing them to thread these.
    cover_art_synth_url: str = ""
    cover_art_synth_hmac_secret: str = ""
    cover_art_synth_timeout_seconds: float = 180.0
    cover_art_bucket: str = "cover-art"
    cover_art_queue_name: str = "cover_art_jobs"
    cover_art_dlq_name: str = "cover_art_jobs_dlq"
    cover_art_visibility_seconds: int = 120
    cover_art_max_attempts: int = 3
    cover_art_poll_interval_seconds: float = 2.0

    # v1.4 Sprint 11 — stems-synth sidecar (optional). When `stems_synth_url`
    # is empty the worker still renders songs, just without transition
    # stems. This is the default for local dev + the path the song-render
    # tests exercise.
    stems_synth_url: str = ""
    stems_synth_hmac_secret: str = ""
    stems_synth_timeout_seconds: float = 60.0
    # Max stem inserts per song. Caps cost on long target_duration_seconds
    # while still meeting the Sprint 11 contract (≥3 inserts on a
    # bhavageete render).
    stems_max_inserts_per_song: int = 4

    # v1.4 Sprint 16 — RLHF reranker checkpoint. Optional: when None the
    # worker falls back to the bundled config-seeded head (deterministic
    # hash-of-path scoring). On DGX this path lives under the trained
    # reranker artefact directory.
    reranker_checkpoint_path: Path | None = None

    # v1.5 Sprint 1 — Pratyabhijna World Model lyric expansion. When
    # pwm_api_url is empty the worker skips PWM entirely and proceeds with
    # whatever lyrics the document already carries (or none, in the prompt
    # branch). The sidecar lives at http://pwm-api:9000 in docker-compose.
    pwm_api_url: str = ""
    pwm_hmac_secret: str = ""
    pwm_lyric_timeout_seconds: float = 120.0

    # v1.5 Sprint 1 — IndicBART lyric-gen fallback. Fills sections that
    # still have no lyrics after PWM expansion (or when PWM is not configured).
    # Indic languages only; English sections are skipped automatically.
    lyric_gen_url: str = ""
    lyric_gen_hmac_secret: str = ""
    lyric_gen_timeout_seconds: float = 180.0


def load_settings() -> Settings:
    raw_langs = os.environ.get("VOCAL_LANGUAGES", "")
    vocal_languages = tuple(
        s.strip() for s in raw_langs.split(",") if s.strip()
    )
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
        vocal_synth_url=os.environ.get("VOCAL_SYNTH_URL", ""),
        vocal_synth_hmac_secret=os.environ.get("VOCAL_SYNTH_HMAC_SECRET", ""),
        vocal_synth_timeout_seconds=float(
            os.environ.get("VOCAL_SYNTH_TIMEOUT_SECONDS", "600"),
        ),
        vocal_languages=vocal_languages,
        vocal_voice_timbre=os.environ.get("VOCAL_VOICE_TIMBRE", "androgynous"),
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
        governor_state_path=Path(
            os.environ.get("GOVERNOR_STATE_PATH", "/var/run/neo-fm/governor.state"),
        ),
        governor_poll_seconds=float(
            os.environ.get("GOVERNOR_POLL_SECONDS", "2"),
        ),
        metrics_port=int(os.environ.get("METRICS_PORT", "9101")),
        cover_art_synth_url=os.environ.get("COVER_ART_SYNTH_URL", ""),
        cover_art_synth_hmac_secret=os.environ.get("COVER_ART_SYNTH_HMAC_SECRET", ""),
        cover_art_synth_timeout_seconds=float(
            os.environ.get("COVER_ART_SYNTH_TIMEOUT_SECONDS", "180"),
        ),
        cover_art_bucket=os.environ.get("COVER_ART_BUCKET", "cover-art"),
        cover_art_queue_name=os.environ.get("COVER_ART_QUEUE_NAME", "cover_art_jobs"),
        cover_art_dlq_name=os.environ.get("COVER_ART_DLQ_NAME", "cover_art_jobs_dlq"),
        cover_art_visibility_seconds=int(
            os.environ.get("COVER_ART_VISIBILITY_SECONDS", "120"),
        ),
        cover_art_max_attempts=int(os.environ.get("COVER_ART_MAX_ATTEMPTS", "3")),
        cover_art_poll_interval_seconds=float(
            os.environ.get("COVER_ART_POLL_INTERVAL_SECONDS", "2"),
        ),
        stems_synth_url=os.environ.get("STEMS_SYNTH_URL", ""),
        stems_synth_hmac_secret=os.environ.get("STEMS_SYNTH_HMAC_SECRET", ""),
        stems_synth_timeout_seconds=float(
            os.environ.get("STEMS_SYNTH_TIMEOUT_SECONDS", "60"),
        ),
        stems_max_inserts_per_song=int(
            os.environ.get("STEMS_MAX_INSERTS_PER_SONG", "4"),
        ),
        reranker_checkpoint_path=(
            Path(os.environ["RERANKER_CHECKPOINT_PATH"])
            if os.environ.get("RERANKER_CHECKPOINT_PATH")
            else None
        ),
        pwm_api_url=os.environ.get("PWM_API_URL", ""),
        pwm_hmac_secret=os.environ.get("PWM_HMAC_SECRET", ""),
        pwm_lyric_timeout_seconds=float(
            os.environ.get("PWM_LYRIC_TIMEOUT_SECONDS", "120"),
        ),
        lyric_gen_url=os.environ.get("LYRIC_GEN_URL", ""),
        lyric_gen_hmac_secret=os.environ.get("LYRIC_GEN_HMAC_SECRET", ""),
        lyric_gen_timeout_seconds=float(
            os.environ.get("LYRIC_GEN_TIMEOUT_SECONDS", "180"),
        ),
    )
