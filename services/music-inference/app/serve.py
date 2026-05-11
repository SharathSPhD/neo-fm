"""
Phase 0 stub for the music-inference service.

Implements the shape of docs/contracts/openapi-dgx.yaml so the dgx-worker can be
wired against a real (if inert) HTTP surface from day 1. POST /v1/generate
deliberately returns 501 so we never confuse a stub run for a real generation.

Two cross-cutting concerns ship in Phase 0:

- HMAC authentication on /v1/generate (ADR 0003). The shared secret is injected
  via env (MUSIC_INFERENCE_HMAC_SECRET). /healthz remains unauthenticated for
  the docker healthcheck.
- Structured JSON logs (ADR 0007). Every request emits one JSON line with
  request_id, route, status, latency_ms, plus model state for /v1/generate.

Phase 1 swaps the body of `generate` with real HeartMuLa inference and adds
eager model load at startup (TRIZ C2).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import sys
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated, Any, Literal

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

PHASE = 0
MODEL_LOADED = False
MODEL_VERSION: str | None = None

HMAC_HEADER_SIG = "x-neofm-signature"
HMAC_HEADER_TS = "x-neofm-timestamp"
HMAC_HEADER_TRACE = "x-neofm-trace-id"
HMAC_MAX_SKEW_SECONDS = 60


def _configure_logger() -> logging.Logger:
    """JSON-only stdout logger; one log record per line."""

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

    logger = logging.getLogger("music-inference")
    logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))
    logger.propagate = False
    if not logger.handlers:
        handler = logging.StreamHandler(stream=sys.stdout)
        handler.setFormatter(_JsonFormatter())
        logger.addHandler(handler)
    return logger


log = _configure_logger()


def _hmac_secrets() -> list[bytes]:
    """Active + optional next secret (ADR 0003 rotation)."""
    out: list[bytes] = []
    primary = os.environ.get("MUSIC_INFERENCE_HMAC_SECRET", "")
    nxt = os.environ.get("MUSIC_INFERENCE_HMAC_SECRET_NEXT", "")
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
    """Authenticates internal calls + emits one JSON log line per request."""

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
                                "MUSIC_INFERENCE_HMAC_SECRET is not set on this "
                                "music-inference container. See ADR 0003."
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

        try:
            response = await call_next(request)
            latency_ms = int((time.perf_counter() - start) * 1000)
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
        except Exception:
            latency_ms = int((time.perf_counter() - start) * 1000)
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


app = FastAPI(
    title="neo-fm music-inference",
    version="0.0.0",
    description=(
        "Internal API; never exposed to the public internet. See "
        "docs/contracts/openapi-dgx.yaml for the authoritative contract."
    ),
)
app.add_middleware(HmacAndLogMiddleware)


class HealthzResponse(BaseModel):
    status: Literal["ok", "degraded"]
    model_loaded: bool
    model_version: str | None = None
    gpu_memory_used_mb: int | None = None
    gpu_utilization_pct: int | None = None
    queue_lag_seconds: int | None = None
    phase: int


class GenerateRequestSection(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: str
    lyrics: str | None = None
    language: str | None = None
    script: Literal["devanagari", "tamil", "kannada", "latin"] | None = None
    transliteration: str | None = None
    swara_sequence: str | None = None
    phonemes: list[str] | None = None
    target_seconds: Annotated[int, Field(ge=1, le=360)]
    tags: list[str] | None = None


class GenerateRequest(BaseModel):
    job_id: str
    attempt_id: str | None = None
    style_family: Literal["western", "carnatic", "hindustani", "kannada-folk"]
    tempo_bpm: int | None = Field(default=None, ge=30, le=240)
    time_signature: str | None = None
    tala: str | None = None
    target_duration_seconds: int | None = Field(default=None, ge=1, le=360)
    sections: list[GenerateRequestSection] = Field(min_length=1)
    output_format: Literal["wav", "mp3", "flac"] = "wav"
    sample_rate: int = 48000


class ErrorBody(BaseModel):
    error: str
    details: dict[str, Any] | None = None


@app.get("/healthz", response_model=HealthzResponse, tags=["health"])
def healthz() -> HealthzResponse:
    return HealthzResponse(
        status="ok",
        model_loaded=MODEL_LOADED,
        model_version=MODEL_VERSION,
        gpu_memory_used_mb=None,
        gpu_utilization_pct=None,
        queue_lag_seconds=None,
        phase=PHASE,
    )


@app.post(
    "/v1/generate",
    tags=["generate"],
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
    responses={
        401: {"model": ErrorBody, "description": "invalid HMAC or stale timestamp"},
        501: {"model": ErrorBody, "description": "not implemented yet (Phase 0 stub)"},
    },
)
def generate(req: GenerateRequest) -> ErrorBody:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail={
            "error": "phase_0_stub",
            "details": {
                "message": (
                    "music-inference is in Phase 0 stub mode. Real HeartMuLa "
                    "generation lands in Phase 1."
                ),
                "received_sections": len(req.sections),
                "style_family": req.style_family,
                "phase": PHASE,
            },
        },
    )
