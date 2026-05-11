"""
Phase 0 stub for the music-inference service.

Implements the shape of docs/contracts/openapi-dgx.yaml so the dgx-worker can be
wired against a real (if inert) HTTP surface from day 1. POST /v1/generate
deliberately returns 501 so we never confuse a stub run for a real generation.

Phase 1 swaps the body of `generate` with real HeartMuLa inference and adds
eager model load at startup (TRIZ C2).
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field

PHASE = 0
MODEL_LOADED = False
MODEL_VERSION: str | None = None

app = FastAPI(
    title="neo-fm music-inference",
    version="0.0.0",
    description=(
        "Internal API; never exposed to the public internet. See "
        "docs/contracts/openapi-dgx.yaml for the authoritative contract."
    ),
)


class HealthzResponse(BaseModel):
    status: Literal["ok", "degraded"]
    model_loaded: bool
    model_version: str | None = None
    gpu_memory_used_mb: int | None = None
    queue_lag_seconds: int | None = None
    phase: int


class GenerateRequestSection(BaseModel):
    id: str
    lyrics: str | None = None
    language: str | None = None
    tags: list[str] | None = None
    target_seconds: Annotated[int, Field(ge=1, le=360)]


class GenerateRequest(BaseModel):
    job_id: str
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
        queue_lag_seconds=None,
        phase=PHASE,
    )


@app.post(
    "/v1/generate",
    tags=["generate"],
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
    responses={
        501: {"model": ErrorBody, "description": "not implemented yet (Phase 0 stub)"}
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
                "phase": PHASE,
            },
        },
    )
