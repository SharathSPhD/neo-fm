"""Prometheus metrics for vocal-synth (ADR 0007, Sprint 7).

Mirrors music-inference's metrics surface; the operator dashboard
already has the panel templates from the music-inference exporter,
so we keep the metric names parallel.
"""

from __future__ import annotations

from prometheus_client import (
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    Info,
    generate_latest,
)

REGISTRY = CollectorRegistry()

_LATENCY_BUCKETS = (0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 240)

requests_total = Counter(
    "neofm_vocal_synth_requests_total",
    "Total HTTP requests by route + status code.",
    ["route", "status_code"],
    registry=REGISTRY,
)

request_latency_seconds = Histogram(
    "neofm_vocal_synth_request_latency_seconds",
    "Latency of each HTTP request (seconds).",
    ["route"],
    buckets=_LATENCY_BUCKETS,
    registry=REGISTRY,
)

in_flight = Gauge(
    "neofm_vocal_synth_in_flight",
    "Number of in-flight requests per route.",
    ["route"],
    registry=REGISTRY,
)

wall_seconds = Histogram(
    "neofm_vocal_synth_wall_seconds",
    "Wall-clock seconds spent inside the vocal model per /v1/vocalize.",
    ["language"],
    buckets=_LATENCY_BUCKETS,
    registry=REGISTRY,
)

model_info = Info(
    "neofm_vocal_synth_model",
    "Active vocal model state.",
    registry=REGISTRY,
)


def set_model_info(*, model_version: str | None, phase: int, loaded: bool) -> None:
    model_info.info(
        {
            "model_version": model_version or "unknown",
            "phase": str(phase),
            "loaded": "true" if loaded else "false",
        },
    )


def render_metrics() -> tuple[bytes, str]:
    return generate_latest(REGISTRY), "text/plain; version=0.0.4; charset=utf-8"
