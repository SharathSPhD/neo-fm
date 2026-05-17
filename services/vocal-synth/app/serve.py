"""
vocal-synth FastAPI service.

Internal API (never internet-facing). Authenticates with HMAC just like
music-inference (ADR 0003); structured JSON logs (ADR 0007).

Endpoints:
    GET  /healthz       -- service health + model state
    POST /v1/vocalize   -- render a mono vocal stem (WAV) for a song

Model layer is `app.model`; tests substitute `FakeVocalModel`.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import sys
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.responses import Response as FastAPIResponse
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app import metrics as metrics_module
from app import model as model_module
from app.model import VocalRequest, VocalSection
from app.routing import RoutingVocalModel

PHASE = 5

HMAC_HEADER_SIG = "x-neofm-signature"
HMAC_HEADER_TS = "x-neofm-timestamp"
HMAC_HEADER_TRACE = "x-neofm-trace-id"
HMAC_MAX_SKEW_SECONDS = 60


def _configure_logger() -> logging.Logger:
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

    logger = logging.getLogger("vocal-synth")
    logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))
    logger.propagate = False
    if not logger.handlers:
        h = logging.StreamHandler(stream=sys.stdout)
        h.setFormatter(_JsonFormatter())
        logger.addHandler(h)
    return logger


log = _configure_logger()


def _hmac_secrets() -> list[bytes]:
    out: list[bytes] = []
    primary = os.environ.get("VOCAL_SYNTH_HMAC_SECRET", "")
    nxt = os.environ.get("VOCAL_SYNTH_HMAC_SECRET_NEXT", "")
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


class HmacAndLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = uuid.uuid4().hex
        trace_id = request.headers.get(HMAC_HEADER_TRACE)
        start = time.perf_counter()

        body = b""
        if request.url.path.startswith("/v1/"):
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
                                "VOCAL_SYNTH_HMAC_SECRET is not set on this "
                                "vocal-synth container. See ADR 0003."
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

            async def _body_replay() -> dict[str, Any]:
                return {"type": "http.request", "body": body, "more_body": False}

            request._receive = _body_replay

        request.state.request_id = request_id
        request.state.trace_id = trace_id
        route_label = request.url.path
        metrics_module.in_flight.labels(route=route_label).inc()
        try:
            response = await call_next(request)
            latency_ms = int((time.perf_counter() - start) * 1000)
            metrics_module.requests_total.labels(
                route=route_label,
                status_code=str(response.status_code),
            ).inc()
            metrics_module.request_latency_seconds.labels(
                route=route_label,
            ).observe(latency_ms / 1000.0)
            extra: dict[str, Any] = {
                "request_id": request_id,
                "trace_id": trace_id,
                "route": request.url.path,
                "method": request.method,
                "status": response.status_code,
                "latency_ms": latency_ms,
                "phase": PHASE,
            }
            for k in ("model_version", "wall_seconds"):
                v = getattr(request.state, k, None)
                if v is not None:
                    extra[k] = v
            log.info("request", extra={"extra_fields": extra})
            response.headers["X-NeoFM-Request-Id"] = request_id
            return response
        except Exception:
            latency_ms = int((time.perf_counter() - start) * 1000)
            metrics_module.requests_total.labels(
                route=route_label,
                status_code="500",
            ).inc()
            metrics_module.request_latency_seconds.labels(
                route=route_label,
            ).observe(latency_ms / 1000.0)
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
        finally:
            metrics_module.in_flight.labels(route=route_label).dec()


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Install the active vocal model.

    v1.3 Sprint 4 wires `RoutingVocalModel` -- the language-aware
    backend picker that was dead code through v1.2 -- as the default
    when `VOCAL_MODEL_BACKEND=routing` (the new prod default). The
    `initialise_from_env` path is preserved for single-backend
    operators who want to pin Svara or Parler explicitly.
    """
    if (
        os.environ.get("VOCAL_SYNTH_SKIP_LIFESPAN") != "1"
        and model_module.get_active_model() is None
    ):
        backend = os.environ.get("VOCAL_MODEL_BACKEND", "routing")
        try:
            if backend == "routing":
                routing = RoutingVocalModel()
                # The routing model is always "loaded" -- it falls back
                # to FakeVocalModel per-section if a real backend can't
                # be reached, which is exactly the v1.3 prod posture.
                model_module.set_active_model(routing)
            else:
                await asyncio.to_thread(model_module.initialise_from_env)
        except Exception:
            log.exception("model_load_failed", extra={"extra_fields": {"phase": PHASE}})
    yield


app = FastAPI(
    title="neo-fm vocal-synth",
    version="0.1.0",
    description="Internal API. See docs/contracts/openapi-vocal-synth.yaml.",
    lifespan=_lifespan,
)
app.add_middleware(HmacAndLogMiddleware)


class HealthzResponse(BaseModel):
    status: Literal["ok", "degraded"]
    model_loaded: bool
    model_version: str | None = None
    phase: int


class VocalizeRequestSection(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: str
    lyrics: str | None = None
    language: str | None = None
    script: (
        Literal["devanagari", "tamil", "kannada", "telugu", "bengali", "latin"]
        | None
    ) = None
    transliteration: str | None = None
    # v1.3 Sprint 4: co-composer phoneme stream. Omitted on legacy
    # documents; the router falls back to text-based preprocessing
    # when missing.
    phonemes: list[str] | None = None
    target_seconds: Annotated[int, Field(ge=1, le=360)]
    tempo_bpm: int | None = None
    raga_name: str | None = None


class VocalizeRequest(BaseModel):
    job_id: str
    attempt_id: str | None = None
    trace_id: str | None = None
    language: Literal["en", "hi", "kn", "ta", "te", "bn"]
    style_family: Literal[
        "western",
        "carnatic",
        "hindustani",
        "kannada-folk",
        "kannada-light-classical",
        "tamil-folk",
    ]
    voice_timbre: Literal["male", "female", "androgynous"] = "androgynous"
    sample_rate: int = 48000
    target_duration_seconds: Annotated[int, Field(ge=1, le=600)]
    sections: list[VocalizeRequestSection] = Field(min_length=1)


class ErrorBody(BaseModel):
    error: str
    details: dict[str, Any] | None = None


@app.get("/healthz", response_model=HealthzResponse, tags=["health"])
def healthz() -> HealthzResponse:
    m = model_module.get_active_model()
    metrics_module.set_model_info(
        model_version=(m.model_version if m else None),
        phase=PHASE,
        loaded=bool(m and m.model_loaded),
    )
    return HealthzResponse(
        status="ok" if (m is None or m.model_loaded) else "degraded",
        model_loaded=bool(m and m.model_loaded),
        model_version=(m.model_version if m else None),
        phase=PHASE,
    )


@app.get("/metrics", include_in_schema=False)
def metrics_endpoint() -> FastAPIResponse:
    """Prometheus exposition endpoint (ADR 0007, Sprint 7)."""
    payload, ctype = metrics_module.render_metrics()
    return FastAPIResponse(content=payload, media_type=ctype)


def _coerce(req: VocalizeRequest) -> VocalRequest:
    sections = [
        VocalSection(
            id=s.id,
            type=s.type,
            lyrics=s.lyrics,
            language=s.language or req.language,
            script=s.script,
            transliteration=s.transliteration,
            phonemes=tuple(s.phonemes) if s.phonemes is not None else None,
            target_seconds=s.target_seconds,
            tempo_bpm=s.tempo_bpm,
            raga_name=s.raga_name,
            voice_timbre=req.voice_timbre,
        )
        for s in req.sections
    ]
    target_total = req.target_duration_seconds or sum(s.target_seconds for s in sections)
    return VocalRequest(
        job_id=req.job_id,
        attempt_id=req.attempt_id,
        trace_id=req.trace_id,
        language=req.language,
        style_family=req.style_family,
        voice_timbre=req.voice_timbre,
        sample_rate=req.sample_rate,
        sections=sections,
        target_duration_seconds=target_total,
    )


@app.post(
    "/v1/vocalize",
    tags=["vocalize"],
    responses={
        200: {
            "description": "Mono WAV at request.sample_rate.",
            "content": {"audio/wav": {"schema": {"type": "string", "format": "binary"}}},
        },
        401: {"model": ErrorBody, "description": "invalid HMAC or stale timestamp"},
        503: {"model": ErrorBody, "description": "model is still loading"},
    },
)
async def vocalize(req: VocalizeRequest, request: Request) -> FastAPIResponse:
    m = model_module.get_active_model()
    if m is None or not m.model_loaded:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "model_not_loaded",
                "details": {
                    "message": "Vocal model is not loaded yet.",
                    "phase": PHASE,
                },
            },
        )
    vr = _coerce(req)
    start = time.perf_counter()
    audio_bytes = await asyncio.to_thread(m.synthesise, vr)
    wall = round(time.perf_counter() - start, 3)
    request.state.model_version = m.model_version or "unknown"
    request.state.wall_seconds = wall
    metrics_module.wall_seconds.labels(language=req.language).observe(wall)
    metrics_module.set_model_info(
        model_version=m.model_version,
        phase=PHASE,
        loaded=True,
    )
    return FastAPIResponse(
        content=audio_bytes,
        media_type="audio/wav",
        headers={
            "X-NeoFM-Model-Version": m.model_version or "unknown",
            "X-NeoFM-Job-Id": req.job_id,
        },
    )
