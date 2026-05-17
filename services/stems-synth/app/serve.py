"""
stems-synth FastAPI service (v1.4 Sprint 11).

Internal API. Authenticates with HMAC per ADR 0003; structured JSON
logs per ADR 0007. Endpoint surface:

    GET  /healthz             — service health + model state
    GET  /metrics             — Prometheus exposition
    POST /v1/generate-stem    — render a 16-bit / 44.1 kHz WAV

Same boilerplate as `services/lyric-gen/`; tests substitute
`FakeStemModel`.
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
from pydantic import BaseModel, Field, model_validator
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app import metrics as metrics_module
from app import model as model_module
from app.model import STEM_PRESETS, StemRequest

PHASE = 11  # v1.4 Sprint 11.

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

    logger = logging.getLogger("stems-synth")
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
    primary = os.environ.get("STEMS_SYNTH_HMAC_SECRET", "")
    nxt = os.environ.get("STEMS_SYNTH_HMAC_SECRET_NEXT", "")
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
                                "STEMS_SYNTH_HMAC_SECRET is not set on "
                                "this stems-synth container. See ADR 0003."
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

            request._receive = _body_replay  # type: ignore[attr-defined]

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
            for k in ("model_version", "wall_seconds", "backend", "preset"):
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
    if (
        os.environ.get("STEMS_SYNTH_SKIP_LIFESPAN") != "1"
        and model_module.get_active_model() is None
    ):
        try:
            await asyncio.to_thread(model_module.initialise_from_env)
        except Exception:
            log.exception(
                "model_load_failed", extra={"extra_fields": {"phase": PHASE}}
            )
    yield


app = FastAPI(
    title="neo-fm stems-synth",
    version="0.1.0",
    description="Internal API. See docs/contracts/openapi-stems-synth.yaml.",
    lifespan=_lifespan,
)
app.add_middleware(HmacAndLogMiddleware)


class HealthzResponse(BaseModel):
    status: Literal["ok", "degraded"]
    model_loaded: bool
    model_version: str | None = None
    backend: str | None = None
    presets: list[str]
    phase: int


StyleFamilyLiteral = Literal[
    "western",
    "carnatic",
    "hindustani",
    "kannada-folk",
    "kannada-light-classical",
    "tamil-folk",
    "bollywood-ballad",
    "bengali-rabindrasangeet",
    "telugu-keerthana",
    "sanskrit-shloka",
]


class GenerateStemRequest(BaseModel):
    job_id: str = Field(min_length=1, max_length=128)
    attempt_id: str | None = None
    trace_id: str | None = None
    style_family: StyleFamilyLiteral
    preset: str | None = Field(default=None, max_length=64)
    prompt: str | None = Field(default=None, max_length=512)
    duration_seconds: Annotated[float, Field(ge=1.0, le=12.0)] = 6.0
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1)
    decode_steps: Annotated[int, Field(ge=1, le=200)] = 50
    cfg_scale: Annotated[float, Field(ge=1.0, le=20.0)] = 6.0

    @model_validator(mode="after")
    def _exactly_one_of_preset_or_prompt(self) -> GenerateStemRequest:
        # XOR: preset XOR prompt. The model layer enforces too, but we
        # fail at the wire boundary with a clean 422 instead of a 500.
        has_preset = self.preset is not None and self.preset != ""
        has_prompt = self.prompt is not None and self.prompt.strip() != ""
        if has_preset == has_prompt:
            raise ValueError(
                "exactly one of `preset` or `prompt` must be provided"
            )
        if has_preset and self.preset not in STEM_PRESETS:
            raise ValueError(
                f"unknown preset {self.preset!r}; "
                f"valid presets: {sorted(STEM_PRESETS)}"
            )
        return self


class ErrorBody(BaseModel):
    error: str
    details: dict[str, Any] | None = None


@app.get("/healthz", response_model=HealthzResponse, tags=["health"])
def healthz() -> HealthzResponse:
    m = model_module.get_active_model()
    metrics_module.set_model_info(
        backend=(m.backend if m else "unset"),
        model_version=(m.model_version if m else None),
        phase=PHASE,
        loaded=bool(m and m.model_loaded),
    )
    return HealthzResponse(
        status="ok" if (m is None or m.model_loaded) else "degraded",
        model_loaded=bool(m and m.model_loaded),
        model_version=(m.model_version if m else None),
        backend=(m.backend if m else None),
        presets=sorted(STEM_PRESETS),
        phase=PHASE,
    )


@app.get("/metrics", include_in_schema=False)
def metrics_endpoint() -> FastAPIResponse:
    payload, ctype = metrics_module.render_metrics()
    return FastAPIResponse(content=payload, media_type=ctype)


@app.post(
    "/v1/generate-stem",
    tags=["generate"],
    responses={
        200: {
            "description": "16-bit / 44.1 kHz mono WAV bytes.",
            "content": {"audio/wav": {"schema": {"type": "string", "format": "binary"}}},
        },
        401: {"model": ErrorBody, "description": "invalid HMAC or stale timestamp"},
        503: {"model": ErrorBody, "description": "model is still loading"},
    },
)
async def generate_stem(
    req: GenerateStemRequest, request: Request
) -> FastAPIResponse:
    m = model_module.get_active_model()
    if m is None or not m.model_loaded:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "model_not_loaded",
                "details": {
                    "message": "stems-synth model is not loaded yet.",
                    "phase": PHASE,
                },
            },
        )

    domain_req = StemRequest(
        job_id=req.job_id,
        attempt_id=req.attempt_id,
        style_family=req.style_family,
        preset=req.preset,
        prompt=req.prompt,
        duration_seconds=req.duration_seconds,
        seed=req.seed,
        decode_steps=req.decode_steps,
        cfg_scale=req.cfg_scale,
    )

    start = time.perf_counter()
    result = await asyncio.to_thread(m.generate, domain_req)
    wall = round(time.perf_counter() - start, 3)

    request.state.model_version = result.model_version
    request.state.wall_seconds = wall
    request.state.backend = result.backend
    request.state.preset = req.preset or "free-prompt"

    metrics_module.wall_seconds.labels(preset=req.preset or "free-prompt").observe(wall)
    metrics_module.set_model_info(
        backend=result.backend,
        model_version=result.model_version,
        phase=PHASE,
        loaded=True,
    )

    return FastAPIResponse(
        content=result.audio,
        media_type="audio/wav",
        headers={
            "X-NeoFM-Model-Version": result.model_version,
            "X-NeoFM-Backend": result.backend,
            "X-NeoFM-Job-Id": req.job_id,
            "X-NeoFM-Preset": req.preset or "",
            "X-NeoFM-Duration-Seconds": f"{result.duration_seconds:.3f}",
        },
    )
