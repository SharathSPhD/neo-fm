"""
music-inference service.

Implements `docs/contracts/openapi-dgx.yaml`. The dgx-worker authenticates with
HMAC (ADR 0003) and POSTs a `GenerateRequest`; we return the rendered audio.

Phase 0 returned 501. Phase 1 (this revision) wires the request through
`app.model.HeartMuLaModel` so the response is a real WAV. The model layer is
behind a `MusicModel` protocol so tests substitute a `FakeMusicModel` -- no
torch/heartlib in CI.

Cross-cutting concerns:

- HMAC authentication on /v1/generate (ADR 0003). The shared secret is injected
  via env (MUSIC_INFERENCE_HMAC_SECRET). /healthz remains unauthenticated for
  the docker healthcheck.
- Structured JSON logs (ADR 0007). Every request emits one JSON line with
  request_id, route, status, latency_ms, plus model state for /v1/generate.
- Eager model load at startup (TRIZ C2): the first user request must not pay
  the cold-start tax. Override with HEARTMULA_DEFER_LOAD=1 in environments
  where the GPU isn't ready at process start (e.g. shared schedulers).
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
from app.model import (
    GenerationRequest,
    GenerationSection,
    MusicModel,
)

PHASE = 1

HMAC_HEADER_SIG = "x-neofm-signature"
HMAC_HEADER_TS = "x-neofm-timestamp"
HMAC_HEADER_TRACE = "x-neofm-trace-id"
HMAC_MAX_SKEW_SECONDS = 60


def _gpu_memory_used_mb() -> int | None:
    """Best-effort GPU-memory-in-use reading (MB), or None.

    ADR 0007 wants this in /healthz and on every /v1/generate log line.
    Three sources, in order of fidelity:

    1. `torch.cuda.memory_allocated()` -- accurate within the current
       process (ignores other CUDA tenants but we don't share GPUs).
    2. `nvidia-smi --query-gpu=memory.used` -- whole-device view; works
       even when torch isn't imported.
    3. None -- no CUDA, no nvidia-smi (developer workstation / CI).
    """
    try:
        import torch  # type: ignore[import-not-found]

        if torch.cuda.is_available():
            mem_bytes = int(torch.cuda.memory_allocated())
            return mem_bytes // (1024 * 1024)
    except Exception:
        # torch not installed in CI; fall through to nvidia-smi.
        pass

    try:
        import subprocess

        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            check=True,
            capture_output=True,
            text=True,
            timeout=2,
        )
        first_line = out.stdout.strip().splitlines()[0]
        return int(first_line)
    except Exception:
        return None


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
            extra_fields: dict[str, Any] = {
                "request_id": request_id,
                "trace_id": trace_id,
                "route": request.url.path,
                "method": request.method,
                "status": response.status_code,
                "latency_ms": latency_ms,
                "phase": PHASE,
            }
            # ADR 0007: /v1/generate carries model_version + gpu_memory_used_mb
            # + wall_seconds. The endpoint stashes them on request.state so the
            # middleware can append without re-reading model state.
            for k in ("model_version", "gpu_memory_used_mb", "wall_seconds"):
                v = getattr(request.state, k, None)
                if v is not None:
                    extra_fields[k] = v
            log.info("request", extra={"extra_fields": extra_fields})
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
    """Eager-load the model on startup unless explicitly opted out.

    Tests skip this entirely by setting `MUSIC_INFERENCE_SKIP_LIFESPAN=1`
    and installing a FakeMusicModel via `app.model.set_active_model`.
    """
    if (
        os.environ.get("MUSIC_INFERENCE_SKIP_LIFESPAN") != "1"
        and model_module.get_active_model() is None
    ):
        try:
            await asyncio.to_thread(model_module.initialise_from_env)
        except Exception:
            log.exception(
                "model_load_failed",
                extra={"extra_fields": {"phase": PHASE}},
            )
            # Don't crash the process: /healthz reports model_loaded=False
            # and /v1/generate replies 503 until weights are available.
    yield


app = FastAPI(
    title="neo-fm music-inference",
    version="0.1.0",
    description=(
        "Internal API; never exposed to the public internet. See "
        "docs/contracts/openapi-dgx.yaml for the authoritative contract."
    ),
    lifespan=_lifespan,
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
    # The Zod source-of-truth (`packages/song-doc/src/index.ts`) and the
    # cloud/DGX OpenAPI contracts (see `docs/contracts/openapi-{cloud,dgx}.yaml`
    # `SectionScript` enum) both include `telugu` and `bengali`. Keep this
    # Literal in lock-step so Pydantic does not silently reject a valid
    # cloud payload at the boundary. Sprint 0 truth-up.
    script: (
        Literal["devanagari", "tamil", "kannada", "telugu", "bengali", "latin"] | None
    ) = None
    transliteration: str | None = None
    swara_sequence: str | None = None
    phonemes: list[str] | None = None
    target_seconds: Annotated[int, Field(ge=1, le=360)]
    tags: list[str] | None = None


class _RagaSpec(BaseModel):
    """Accept-and-forward raga metadata.

    The Song Document carries raga as structured data (name / system /
    arohana / avarohana / nyas / pakad). We keep the wire-format Pydantic
    model permissive (string lists, optional fields) because the
    inference layer's interest is currently limited to (name, system)
    for prompt construction; the rest is reserved for Phase 6 co-composer
    work and Phase 7 vocal synth.
    """

    name: str
    system: Literal["carnatic", "hindustani"]
    arohana: list[str] | None = None
    avarohana: list[str] | None = None
    nyas: list[str] | None = None
    pakad: str | None = None


class _Orchestration(BaseModel):
    lead_vocal: Literal["male", "female", "instrumental"] | None = None
    instruments: list[str] | None = None
    texture: str | None = None


class GenerateRequest(BaseModel):
    job_id: str
    attempt_id: str | None = None
    # `trace_id` is propagated end-to-end per ADR 0007. Worker sends it in
    # the request body; the HMAC middleware also accepts it as the
    # `X-NeoFM-Trace-Id` header (header wins when both are present). The
    # header path is wired in `HmacAndLogMiddleware`; the body field
    # gives the model layer a place to read trace context from in case
    # the middleware is bypassed in a future refactor.
    trace_id: str | None = None
    # `language` is required by the OpenAPI contract (`openapi-dgx.yaml`
    # GenerateRequest.required = [job_id, sections, style_family, language]).
    # We accept None for backwards-compat with the Phase 1 fixtures that
    # predated the contract widening; new payloads from the dgx-worker
    # always include it (see `build_inference_request` in worker.py).
    language: Literal["en", "hi", "kn"] | None = None
    style_family: Literal["western", "carnatic", "hindustani", "kannada-folk"]
    tempo_bpm: int | None = Field(default=None, ge=30, le=240)
    time_signature: str | None = None
    tala: str | None = None
    target_duration_seconds: int | None = Field(default=None, ge=1, le=360)
    # `raga` / `orchestration` are accepted-and-forwarded today. Phase 6
    # plumbs them into the co-composer's HeartMuLa tag synthesis; until
    # then, the model layer simply has them on the GenerationRequest if
    # it wants to peek (see `_coerce_request`). Accepting them at the
    # boundary prevents the 400 the previous narrower model would have
    # returned on a fully-formed cloud payload.
    raga: _RagaSpec | None = None
    orchestration: _Orchestration | None = None
    sections: list[GenerateRequestSection] = Field(min_length=1)
    output_format: Literal["wav", "mp3", "flac"] = "wav"
    sample_rate: int = 48000


class ErrorBody(BaseModel):
    error: str
    details: dict[str, Any] | None = None


@app.get("/healthz", response_model=HealthzResponse, tags=["health"])
def healthz() -> HealthzResponse:
    m = model_module.get_active_model()
    gpu_mb = _gpu_memory_used_mb()
    if gpu_mb is not None:
        metrics_module.gpu_memory_mb.set(gpu_mb)
    metrics_module.set_model_info(
        model_version=m.model_version if m else None,
        phase=PHASE,
        loaded=bool(m and m.model_loaded),
    )
    return HealthzResponse(
        status="ok" if (m is None or m.model_loaded) else "degraded",
        model_loaded=bool(m and m.model_loaded),
        model_version=m.model_version if m else None,
        gpu_memory_used_mb=gpu_mb,
        gpu_utilization_pct=None,
        queue_lag_seconds=None,
        phase=PHASE,
    )


@app.get("/metrics", include_in_schema=False)
def metrics_endpoint() -> FastAPIResponse:
    """Prometheus exposition endpoint (ADR 0007, Sprint 7).

    Unauthenticated by design: only the docker-compose network can
    reach this port. If the service is ever moved off the trusted
    network, gate this endpoint behind HMAC like /v1/generate.
    """
    payload, ctype = metrics_module.render_metrics()
    return FastAPIResponse(content=payload, media_type=ctype)


def _coerce_request(req: GenerateRequest) -> GenerationRequest:
    """Translate the wire-format Pydantic model into the model layer's
    dataclass. Keeps `app.model` free of FastAPI imports."""
    sections = [
        GenerationSection(
            id=s.id,
            type=s.type,
            lyrics=s.lyrics,
            transliteration=s.transliteration,
            swara_sequence=s.swara_sequence,
            target_seconds=s.target_seconds,
            tags=s.tags,
        )
        for s in req.sections
    ]
    target_total = req.target_duration_seconds or sum(s.target_seconds for s in sections)
    return GenerationRequest(
        job_id=req.job_id,
        attempt_id=req.attempt_id,
        style_family=req.style_family,
        target_duration_seconds=target_total,
        sections=sections,
        tempo_bpm=req.tempo_bpm,
        time_signature=req.time_signature,
        tala=req.tala,
        output_format=req.output_format,
        sample_rate=req.sample_rate,
    )


_OUTPUT_MIME: dict[str, str] = {
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
    "flac": "audio/flac",
}


@app.post(
    "/v1/generate",
    tags=["generate"],
    responses={
        200: {
            "description": "Audio bytes in the requested output_format.",
            "content": {
                "audio/wav": {"schema": {"type": "string", "format": "binary"}},
                "audio/mpeg": {"schema": {"type": "string", "format": "binary"}},
                "audio/flac": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        401: {"model": ErrorBody, "description": "invalid HMAC or stale timestamp"},
        503: {"model": ErrorBody, "description": "model is still loading"},
    },
)
async def generate(req: GenerateRequest, request: Request) -> FastAPIResponse:
    m: MusicModel | None = model_module.get_active_model()
    if m is None or not m.model_loaded:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "model_not_loaded",
                "details": {
                    "message": (
                        "Model is not loaded yet. Healthcheck will report "
                        "model_loaded=true once warmup completes."
                    ),
                    "phase": PHASE,
                },
            },
        )

    gen_req = _coerce_request(req)
    # heartlib is blocking; run on a threadpool so we don't stall the
    # event loop. asyncio.to_thread schedules on the default executor.
    model_start = time.perf_counter()
    audio_bytes = await asyncio.to_thread(m.generate, gen_req)
    wall = round(time.perf_counter() - model_start, 3)

    # ADR 0007: hand observability fields to the middleware via request.state
    # rather than emitting a second log line. /healthz reads gpu memory the
    # same way so the two endpoints stay consistent.
    request.state.model_version = m.model_version or "unknown"
    gpu_mb = _gpu_memory_used_mb()
    request.state.gpu_memory_used_mb = gpu_mb
    request.state.wall_seconds = wall

    # Sprint 7: feed Prometheus alongside the JSON log line.
    metrics_module.wall_seconds.labels(style_family=req.style_family).observe(wall)
    if gpu_mb is not None:
        metrics_module.gpu_memory_mb.set(gpu_mb)
    metrics_module.set_model_info(
        model_version=m.model_version,
        phase=PHASE,
        loaded=True,
    )

    return FastAPIResponse(
        content=audio_bytes,
        media_type=_OUTPUT_MIME.get(req.output_format, "application/octet-stream"),
        headers={
            "X-NeoFM-Model-Version": m.model_version or "unknown",
            "X-NeoFM-Job-Id": req.job_id,
        },
    )
