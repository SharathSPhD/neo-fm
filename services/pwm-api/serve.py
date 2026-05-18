"""
pwm-api service.

Thin FastAPI wrapper that exposes the Pratyabhijñā World Model (PWM)
creative-generation API on the neo-fm internal docker-compose network.

Architecture
------------
The PWM project at ``$PWM_PROJECT_PATH`` (default ``/opt/pwm``) holds the
full WM + LLM stack — torch, transformers, a checkpoint, and the Ollama
sidecar. The neo-fm stack does not want to redeclare those dependencies
inside its own image; instead, this wrapper:

1. Adds ``$PWM_PROJECT_PATH`` and ``$PWM_PHASE2_PATH`` to ``sys.path`` at
   import time so the PWM modules resolve.
2. Imports the upstream ``api.main:app`` lazily — if the PWM project
   files aren't mounted (the developer-laptop case, CI smoke), the
   wrapper degrades gracefully: ``/healthz`` returns 503 with
   ``pwm_ready: false`` and all ``/v1/*`` calls return 503.
3. Mounts the upstream PWM API at root so existing PWM clients keep
   working (``POST /generate``, ``GET /result/{job_id}``, etc.).
4. Adds neo-fm-flavoured endpoints under ``/v1/`` that speak the
   neo-fm ``LyricRequest`` schema and translate to PWM's
   ``GenerateRequest``.

Cross-cutting concerns
----------------------
- HMAC authentication on every ``/v1/*`` and ``/generate``-family route
  (ADR 0003). The shared secret is injected via ``PWM_HMAC_SECRET``.
  ``/healthz`` remains unauthenticated for the docker healthcheck.
- Structured JSON logs (ADR 0007): one log line per request with
  ``request_id``, ``route``, ``status``, ``latency_ms``.
- The wrapper does NOT load any ML models itself — PWM's own
  ``lifespan`` does that work when its ``app`` is imported.

Env vars
--------
- ``PWM_HMAC_SECRET``         shared secret for HMAC auth (required for ``/v1/*``)
- ``PWM_HMAC_SECRET_NEXT``    optional rotation secret (ADR 0003)
- ``PWM_PROJECT_PATH``        path to PWM project root (default ``/opt/pwm``)
- ``PWM_PHASE2_PATH``         path to pwm-phase2 source (default ``/opt/pwm-phase2``)
- ``PWM_SKIP_BACKEND_IMPORT`` if ``1``, do not import the real PWM API
                              (tests set this so they own the backend).
- ``LOG_LEVEL``               python logging level (default INFO).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import sys
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.responses import Response as FastAPIResponse
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

PHASE = 1
SERVICE_NAME = "pwm-api"

# --- Prometheus metrics -------------------------------------------------------

_prom_registry = CollectorRegistry()

_pwm_requests_total = Counter(
    "neofm_pwm_api_requests_total",
    "Requests handled by pwm-api, by route + status.",
    labelnames=("route", "status_code"),
    registry=_prom_registry,
)
_pwm_request_latency = Histogram(
    "neofm_pwm_api_request_latency_seconds",
    "Request latency seconds.",
    labelnames=("route",),
    buckets=(0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0),
    registry=_prom_registry,
)
_pwm_in_flight = Gauge(
    "neofm_pwm_api_in_flight",
    "In-flight requests.",
    labelnames=("route",),
    registry=_prom_registry,
)
_pwm_backend_ready = Gauge(
    "neofm_pwm_api_backend_ready",
    "1 if the PWM backend imported successfully, 0 otherwise.",
    registry=_prom_registry,
)
_pwm_lyric_wall_seconds = Histogram(
    "neofm_pwm_api_lyric_wall_seconds",
    "Wall-clock seconds for /v1/generate-lyric (including PWM poll).",
    labelnames=("style_family",),
    buckets=(0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0),
    registry=_prom_registry,
)

HMAC_HEADER_SIG = "x-neofm-signature"
HMAC_HEADER_TS = "x-neofm-timestamp"
HMAC_HEADER_TRACE = "x-neofm-trace-id"
HMAC_MAX_SKEW_SECONDS = 60

# Routes that bypass HMAC. Everything else under /v1/* and the PWM-native
# /generate, /result, /domains, /batch surface is authenticated.
_UNAUTH_ROUTES: frozenset[str] = frozenset(
    {"/healthz", "/health", "/metrics", "/", "/docs", "/openapi.json", "/redoc"}
)

# neo-fm StyleFamily -> PWM Domain. Keep in lock-step with
# `packages/song-doc/src/index.ts` (StyleFamily Literal) and the PWM
# ``Domain`` enum at ``pwm.generation.domain_metadata``.
STYLE_TO_DOMAIN: dict[str, str] = {
    "western": "western_jazz",
    "carnatic": "carnatic_classical",
    "hindustani": "hindustani_classical",
    "kannada-folk": "kannada_film",
    "kannada-light-classical": "kannada_film",
    "tamil-folk": "dravidian_folk",
    "bollywood-ballad": "bollywood",
    "bengali-rabindrasangeet": "bengali_classical",
    "telugu-keerthana": "dravidian_folk",
    "sanskrit-shloka": "sanskrit_classical",
}

# neo-fm language code -> PWM language label. PWM accepts free-form
# language names; we send the canonical English label so prompts read
# the same regardless of caller.
_LANG_TO_PWM: dict[str, str] = {
    "hi": "hindi",
    "kn": "kannada",
    "ta": "tamil",
    "te": "telugu",
    "bn": "bengali",
    "sa": "sanskrit",
    "en": "english",
}


# --- logging --------------------------------------------------------------


def _configure_logger() -> logging.Logger:
    """JSON-only stdout logger; one log record per line (ADR 0007)."""

    class _JsonFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            payload: dict[str, Any] = {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
                "level": record.levelname,
                "msg": record.getMessage(),
            }
            extra = getattr(record, "extra_fields", None)
            if isinstance(extra, dict):
                payload.update(extra)
            return json.dumps(payload, ensure_ascii=False, sort_keys=True)

    logger = logging.getLogger(SERVICE_NAME)
    logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))
    logger.propagate = False
    if not logger.handlers:
        h = logging.StreamHandler(stream=sys.stdout)
        h.setFormatter(_JsonFormatter())
        logger.addHandler(h)
    return logger


log = _configure_logger()


# --- HMAC -----------------------------------------------------------------


def _hmac_secrets() -> list[bytes]:
    """Active + optional next secret (ADR 0003 rotation)."""
    out: list[bytes] = []
    primary = os.environ.get("PWM_HMAC_SECRET", "")
    nxt = os.environ.get("PWM_HMAC_SECRET_NEXT", "")
    if primary:
        out.append(primary.encode("utf-8"))
    if nxt:
        out.append(nxt.encode("utf-8"))
    return out


def _verify_hmac(body: bytes, signature: str, timestamp: str) -> bool:
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    if abs(time.time() - ts) > HMAC_MAX_SKEW_SECONDS:
        return False
    payload = body + b"\n" + timestamp.encode("ascii")
    for secret in _hmac_secrets():
        expected = hmac.new(secret, payload, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, signature):
            return True
    return False


def _route_requires_hmac(path: str) -> bool:
    """Anything in the public unauthenticated set bypasses HMAC; the
    rest of the surface (PWM-native and neo-fm /v1/*) is authenticated."""
    if path in _UNAUTH_ROUTES:
        return False
    # Allow /healthz and /v1/health-style paths through always.
    if path.startswith("/healthz") or path == "/v1/health":
        return False
    return True


# --- PWM backend wiring ---------------------------------------------------


def _add_pwm_paths_to_syspath() -> tuple[Path, Path]:
    """Add PWM project + phase-2 source to sys.path. Idempotent."""
    project = Path(os.environ.get("PWM_PROJECT_PATH", "/opt/pwm")).resolve()
    phase2 = Path(os.environ.get("PWM_PHASE2_PATH", "/opt/pwm-phase2")).resolve()
    for p in (project, phase2):
        spath = str(p)
        if p.exists() and spath not in sys.path:
            sys.path.insert(0, spath)
    return project, phase2


class _BackendState:
    """Loaded-once container for the upstream PWM FastAPI app + helpers.

    ``ready`` is True iff the import succeeded. ``reason`` carries the
    failure detail for /healthz when ready is False. Tests inject a
    ``FakePWMBackend`` directly via ``set_backend``.
    """

    ready: bool = False
    reason: str | None = None
    # PWM ``app`` (FastAPI) — mounted at root when present.
    pwm_app: Any | None = None
    # Direct call hooks the wrapper uses for /v1/generate-lyric. We
    # bind by name so a FakeBackend can swap them in tests.
    generate: Callable[..., Awaitable[dict[str, Any]]] | None = None
    get_result: Callable[..., Awaitable[dict[str, Any]]] | None = None
    health: Callable[..., Awaitable[dict[str, Any]]] | None = None
    GenerateRequest: Any | None = None


_backend = _BackendState()


def _try_import_pwm_backend() -> None:
    """Import ``api.main`` from the PWM project, recording success/failure.

    Failure modes we tolerate without crashing the process:
      - PWM project path not mounted (volume missing on a non-DGX box).
      - PWM heavy deps not importable (torch, transformers, requests).
      - PWM project structure changed (api.main moved).

    In every case we keep the wrapper alive so /healthz can report the
    degraded state for the operator + the docker healthcheck.
    """
    if os.environ.get("PWM_SKIP_BACKEND_IMPORT") == "1":
        _backend.reason = "PWM_SKIP_BACKEND_IMPORT=1"
        return

    project, phase2 = _add_pwm_paths_to_syspath()
    if not project.exists():
        _backend.reason = f"PWM_PROJECT_PATH not found: {project}"
        log.warning(
            "pwm_backend_unavailable",
            extra={"extra_fields": {"reason": _backend.reason}},
        )
        return
    if not phase2.exists():
        # Not fatal — PWM may have inlined phase2 — but worth flagging.
        log.warning(
            "pwm_phase2_path_missing",
            extra={"extra_fields": {"phase2_path": str(phase2)}},
        )

    try:
        from api import main as pwm_main  # type: ignore[import-not-found]

        _backend.pwm_app = getattr(pwm_main, "app", None)
        _backend.generate = getattr(pwm_main, "generate", None)
        _backend.get_result = getattr(pwm_main, "get_result", None)
        _backend.health = getattr(pwm_main, "health", None)
        _backend.GenerateRequest = getattr(pwm_main, "GenerateRequest", None)
        if _backend.pwm_app is None or _backend.GenerateRequest is None:
            _backend.reason = (
                "PWM api.main loaded but `app` or `GenerateRequest` is missing"
            )
            log.warning(
                "pwm_backend_incomplete",
                extra={"extra_fields": {"reason": _backend.reason}},
            )
            return
        _backend.ready = True
        log.info(
            "pwm_backend_loaded",
            extra={
                "extra_fields": {
                    "project_path": str(project),
                    "phase2_path": str(phase2),
                }
            },
        )
    except Exception as exc:  # pragma: no cover - exercised in production only
        _backend.reason = f"{type(exc).__name__}: {exc}"
        log.warning(
            "pwm_backend_import_failed",
            extra={"extra_fields": {"reason": _backend.reason}},
        )


def set_backend(backend: Any) -> None:
    """Test hook: install a fake backend without re-importing.

    The fake must expose ``generate(req)``, ``get_result(job_id)``,
    ``health()`` async-callables and a ``GenerateRequest`` Pydantic
    model with at least ``domain``, ``language``, ``theme``,
    ``music_context``.
    """
    _backend.ready = True
    _backend.reason = None
    _backend.pwm_app = getattr(backend, "app", None)
    _backend.generate = getattr(backend, "generate", None)
    _backend.get_result = getattr(backend, "get_result", None)
    _backend.health = getattr(backend, "health", None)
    _backend.GenerateRequest = getattr(backend, "GenerateRequest", None)


def reset_backend() -> None:
    """Test hook: clear backend state (mirror of set_backend)."""
    _backend.ready = False
    _backend.reason = None
    _backend.pwm_app = None
    _backend.generate = None
    _backend.get_result = None
    _backend.health = None
    _backend.GenerateRequest = None


# --- middleware -----------------------------------------------------------


class HmacAndLogMiddleware(BaseHTTPMiddleware):
    """Authenticates internal calls + emits one JSON log line per request."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = uuid.uuid4().hex
        trace_id = request.headers.get(HMAC_HEADER_TRACE)
        start = time.perf_counter()

        if _route_requires_hmac(request.url.path):
            body = await request.body()

            if not _hmac_secrets():
                log.warning(
                    "request_rejected",
                    extra={
                        "extra_fields": {
                            "request_id": request_id,
                            "trace_id": trace_id,
                            "route": request.url.path,
                            "reason": "hmac_secret_unset",
                        }
                    },
                )
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={
                        "error": "internal_api_unauthenticated",
                        "details": {
                            "message": (
                                "PWM_HMAC_SECRET is not set on this pwm-api "
                                "container. See ADR 0003."
                            )
                        },
                    },
                )

            sig = request.headers.get(HMAC_HEADER_SIG, "")
            ts = request.headers.get(HMAC_HEADER_TS, "")
            if not _verify_hmac(body, sig, ts):
                log.warning(
                    "request_rejected",
                    extra={
                        "extra_fields": {
                            "request_id": request_id,
                            "trace_id": trace_id,
                            "route": request.url.path,
                            "reason": "hmac_invalid_or_stale",
                        }
                    },
                )
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"error": "invalid_signature_or_stale_timestamp"},
                )

            # Replay the body so downstream handlers can re-read it.
            async def _body_replay() -> dict[str, Any]:
                return {"type": "http.request", "body": body, "more_body": False}

            request._receive = _body_replay  # type: ignore[attr-defined]

        request.state.request_id = request_id
        request.state.trace_id = trace_id

        route_label = request.url.path
        _pwm_in_flight.labels(route=route_label).inc()
        try:
            response = await call_next(request)
        except Exception:
            latency_ms = int((time.perf_counter() - start) * 1000)
            _pwm_in_flight.labels(route=route_label).dec()
            _pwm_requests_total.labels(route=route_label, status_code="500").inc()
            _pwm_request_latency.labels(route=route_label).observe(latency_ms / 1000)
            log.exception(
                "request_failed",
                extra={
                    "extra_fields": {
                        "request_id": request_id,
                        "trace_id": trace_id,
                        "route": request.url.path,
                        "latency_ms": latency_ms,
                    }
                },
            )
            raise

        latency_ms = int((time.perf_counter() - start) * 1000)
        _pwm_in_flight.labels(route=route_label).dec()
        _pwm_requests_total.labels(route=route_label, status_code=str(response.status_code)).inc()
        _pwm_request_latency.labels(route=route_label).observe(latency_ms / 1000)
        log.info(
            "request",
            extra={
                "extra_fields": {
                    "request_id": request_id,
                    "trace_id": trace_id,
                    "route": request.url.path,
                    "method": request.method,
                    "status": response.status_code,
                    "latency_ms": latency_ms,
                    "phase": PHASE,
                }
            },
        )
        response.headers["X-NeoFM-Request-Id"] = request_id
        return response


# --- lifespan -------------------------------------------------------------


def _mount_pwm_subapp_if_ready(app_: FastAPI) -> None:
    """Mount the PWM FastAPI app at /pwm once we know it's loaded."""
    if _backend.ready and _backend.pwm_app is not None:
        already = any(
            getattr(r, "path", None) == "/pwm" for r in app_.routes
        )
        if not already:
            app_.mount("/pwm", _backend.pwm_app)
            log.info(
                "pwm_app_mounted",
                extra={"extra_fields": {"prefix": "/pwm"}},
            )


@asynccontextmanager
async def _lifespan(app_: FastAPI) -> AsyncIterator[None]:
    """Try to import the PWM backend once at startup.

    We never crash the process: if the import fails the wrapper stays
    up and /healthz reports ``pwm_ready: false`` until an operator
    repairs the mount.
    """
    try:
        await asyncio.to_thread(_try_import_pwm_backend)
        _mount_pwm_subapp_if_ready(app_)
    except Exception:  # pragma: no cover - defensive belt-and-braces
        log.exception("pwm_backend_load_failed")
    yield


app = FastAPI(
    title="neo-fm pwm-api",
    version="0.1.0",
    description=(
        "Internal API; never exposed to the public internet. Thin wrapper "
        "around the Pratyabhijñā World Model (PWM) creative-generation "
        "backend."
    ),
    lifespan=_lifespan,
)
app.add_middleware(HmacAndLogMiddleware)


# --- schemas --------------------------------------------------------------


class HealthzResponse(BaseModel):
    status: Literal["ok", "degraded"]
    pwm_ready: bool
    reason: str | None = None
    phase: int


class LyricRequest(BaseModel):
    """neo-fm-side request: caller speaks StyleFamily + ISO language code."""

    job_id: str
    trace_id: str
    language: Literal["hi", "kn", "ta", "te", "bn", "sa", "en"]
    style_family: Literal[
        "western",
        "carnatic",
        "hindustani",
        "kannada-folk",
        "kannada-light-classical",
        "tamil-folk",
        "bollywood-ballad",
        "sanskrit-shloka",
        "bengali-rabindrasangeet",
        "telugu-keerthana",
    ]
    prompt: str = Field("", description="User's creative prompt / theme")
    music_context: dict[str, Any] = Field(default_factory=dict)
    timeout_seconds: float = Field(30.0, gt=0, le=600)


class LyricSection(BaseModel):
    type: str
    text: str
    music_context: dict[str, Any] = Field(default_factory=dict)


class LyricResponse(BaseModel):
    job_id: str
    status: Literal["complete", "error", "pending"]
    text: str = ""
    sections: list[LyricSection] = Field(default_factory=list)
    music_context: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


class ErrorBody(BaseModel):
    error: str
    details: dict[str, Any] | None = None


# --- helpers --------------------------------------------------------------


# Common section headers PWM emits across domains. Used to split the
# rendered text into structured sections when the upstream result
# doesn't already carry them.
_SECTION_HEADER_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"^\s*\[(?P<name>[^\]\n]{1,60})\]\s*$",
        re.IGNORECASE | re.MULTILINE,
    ),
    re.compile(
        r"^\s*(?P<name>"
        r"pallavi|anupallavi|caranam|charanam|charaṇa|charaṇam|"
        r"sthayi|sthāyi|antara|antarā|mukhra|mukhara|"
        r"verse(?:\s*\d+)?|chorus|bridge|intro|outro|"
        r"movement\s*[ivx\d]+|section\s*[ivx\d]+"
        r")\s*[:\-]?\s*$",
        re.IGNORECASE | re.MULTILINE,
    ),
)


def _parse_sections(
    text: str,
    music_context: dict[str, Any],
    *,
    pwm_sections: list[dict[str, Any]] | None = None,
) -> list[LyricSection]:
    """Best-effort split of PWM's free-form lyric text into sections.

    Preference order:
      1. ``pwm_sections`` from the upstream result if present.
      2. Explicit ``[Header]`` lines (most PWM domains emit these).
      3. Named headers (Pallavi/Verse/Chorus/...).
      4. Blank-line-separated stanzas as a final fallback.
    """
    if pwm_sections:
        out: list[LyricSection] = []
        for s in pwm_sections:
            if not isinstance(s, dict):
                continue
            out.append(
                LyricSection(
                    type=str(s.get("type") or s.get("name") or "stanza"),
                    text=str(s.get("text") or s.get("lyrics") or "").strip(),
                    music_context=dict(s.get("music_context") or {}),
                )
            )
        if out:
            return out

    text = text or ""
    text_stripped = text.strip()
    if not text_stripped:
        return []

    # Try header-based splits in order of specificity.
    for pat in _SECTION_HEADER_PATTERNS:
        matches = list(pat.finditer(text))
        if len(matches) >= 1:
            sections: list[LyricSection] = []
            for i, m in enumerate(matches):
                name = m.group("name").strip().lower()
                # body runs from end of header to start of next header (or EOF)
                start = m.end()
                end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
                body = text[start:end].strip()
                if body:
                    sections.append(
                        LyricSection(
                            type=name,
                            text=body,
                            music_context=music_context,
                        )
                    )
            if sections:
                return sections

    # Final fallback: blank-line stanzas.
    stanzas = [s.strip() for s in re.split(r"\n\s*\n", text_stripped) if s.strip()]
    if not stanzas:
        return [LyricSection(type="stanza", text=text_stripped, music_context=music_context)]
    return [
        LyricSection(type=f"stanza_{i + 1}", text=s, music_context=music_context)
        for i, s in enumerate(stanzas)
    ]


async def _await_job_result(job_id: str, timeout_seconds: float) -> dict[str, Any]:
    """Poll the PWM ``get_result`` endpoint until the job is complete or
    we exhaust the caller's budget. PWM exposes a streaming SSE channel,
    but for the neo-fm boundary a request/response shape is simpler and
    keeps the worker free of EventSource plumbing.
    """
    assert _backend.get_result is not None  # narrowed by caller
    deadline = time.monotonic() + timeout_seconds
    # Backoff schedule: tight at first (catch fast jobs), then loosen.
    backoff = 0.1
    while True:
        try:
            maybe = _backend.get_result(job_id)
            result: dict[str, Any] = (await maybe) if asyncio.iscoroutine(maybe) else maybe  # type: ignore[assignment]
        except TypeError:
            result = {}
        status_val = (result or {}).get("status", "unknown")
        if status_val in ("complete", "error"):
            return result
        if time.monotonic() >= deadline:
            return {
                "job_id": job_id,
                "status": "error",
                "error": f"timeout after {timeout_seconds:.1f}s",
            }
        await asyncio.sleep(backoff)
        backoff = min(backoff * 1.5, 1.0)


# --- endpoints ------------------------------------------------------------


@app.get("/healthz", response_model=HealthzResponse, tags=["health"])
async def healthz() -> JSONResponse:
    """Liveness + PWM-readiness probe. Always reachable; never 5xx so
    the docker healthcheck reflects degraded state rather than crashing
    on a healthy-but-unloaded container."""
    if _backend.ready:
        return JSONResponse(
            status_code=200,
            content=HealthzResponse(
                status="ok",
                pwm_ready=True,
                reason=None,
                phase=PHASE,
            ).model_dump(),
        )
    return JSONResponse(
        status_code=503,
        content=HealthzResponse(
            status="degraded",
            pwm_ready=False,
            reason=_backend.reason
            or "PWM backend not loaded (project files missing?)",
            phase=PHASE,
        ).model_dump(),
    )


@app.post(
    "/v1/generate-lyric",
    response_model=LyricResponse,
    tags=["generate"],
    responses={
        401: {"model": ErrorBody, "description": "invalid HMAC or stale timestamp"},
        503: {"model": ErrorBody, "description": "PWM backend not loaded"},
    },
)
async def generate_lyric(req: LyricRequest, _request: Request) -> LyricResponse:
    """Translate a neo-fm LyricRequest into PWM and await the result.

    The mapping:
      - ``style_family``  -> ``domain``      via STYLE_TO_DOMAIN
      - ``language``      -> PWM language    via _LANG_TO_PWM
      - ``prompt``        -> ``theme``
      - ``music_context`` -> ``music_context`` (passthrough)
    """
    if not _backend.ready or _backend.generate is None or _backend.GenerateRequest is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "pwm_backend_not_loaded",
                "details": {"reason": _backend.reason or "unknown"},
            },
        )

    if req.style_family not in STYLE_TO_DOMAIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "unsupported_style_family",
                "details": {"style_family": req.style_family},
            },
        )

    pwm_payload: dict[str, Any] = {
        "domain": STYLE_TO_DOMAIN[req.style_family],
        "language": _LANG_TO_PWM.get(req.language, req.language),
        "theme": req.prompt,
        "music_context": dict(req.music_context),
    }

    try:
        pwm_req = _backend.GenerateRequest(**pwm_payload)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "pwm_request_validation_failed",
                "details": {"reason": str(exc)},
            },
        ) from exc

    # PWM's ``generate`` is async and returns ``{job_id, ...}``.
    _lyric_start = time.perf_counter()
    _submit = _backend.generate(pwm_req)
    submit_result: dict[str, Any] = (await _submit) if asyncio.iscoroutine(_submit) else _submit  # type: ignore[assignment]
    pwm_job_id = (submit_result or {}).get("job_id")
    if not pwm_job_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "error": "pwm_generate_no_job_id",
                "details": {"upstream": submit_result},
            },
        )

    result = await _await_job_result(pwm_job_id, req.timeout_seconds)
    _pwm_lyric_wall_seconds.labels(style_family=req.style_family).observe(
        time.perf_counter() - _lyric_start
    )
    if result.get("status") == "error":
        return LyricResponse(
            job_id=req.job_id,
            status="error",
            error=str(result.get("error") or "pwm error"),
            music_context=dict(req.music_context),
        )

    text = str(result.get("text") or "")
    sections = _parse_sections(
        text,
        req.music_context,
        pwm_sections=(
            result.get("sections") if isinstance(result.get("sections"), list) else None
        ),
    )
    return LyricResponse(
        job_id=req.job_id,
        status="complete",
        text=text,
        sections=sections,
        music_context=dict(req.music_context or result.get("music_context") or {}),
    )


@app.get("/metrics", include_in_schema=False)
def metrics_endpoint() -> FastAPIResponse:
    """Prometheus exposition; scraped by infra/prometheus.yml → pwm-api:9000."""
    _pwm_backend_ready.set(1.0 if _backend.ready else 0.0)
    return FastAPIResponse(
        content=generate_latest(_prom_registry),
        media_type=CONTENT_TYPE_LATEST,
    )


@app.get("/v1/health", tags=["health"])
async def v1_health() -> dict[str, Any]:
    """neo-fm-flavoured health: stable JSON shape regardless of PWM
    backend state. Operators and orchestrators poll this rather than
    healthz when they want detail."""
    upstream: dict[str, Any] | None = None
    if _backend.ready and _backend.health is not None:
        try:
            _val = _backend.health()
            upstream = (await _val) if asyncio.iscoroutine(_val) else _val  # type: ignore[assignment]
        except Exception as exc:
            upstream = {"error": str(exc)}
    return {
        "service": SERVICE_NAME,
        "phase": PHASE,
        "pwm_ready": _backend.ready,
        "reason": _backend.reason,
        "upstream": upstream,
    }


# The upstream PWM FastAPI ``app`` is mounted at /pwm by
# ``_mount_pwm_subapp_if_ready`` inside the lifespan once we know the
# import succeeded. Keeping the mount in the lifespan keeps it in lockstep
# with the import outcome and avoids the deprecated ``on_event`` hook.
