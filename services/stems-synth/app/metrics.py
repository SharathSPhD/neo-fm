"""Prometheus exposition for stems-synth (mirrors lyric-gen / music-inference)."""

from __future__ import annotations

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

REGISTRY = CollectorRegistry()

requests_total = Counter(
    "stems_synth_requests_total",
    "Total HTTP requests handled by stems-synth.",
    ("route", "status_code"),
    registry=REGISTRY,
)
in_flight = Gauge(
    "stems_synth_requests_in_flight",
    "In-flight HTTP requests.",
    ("route",),
    registry=REGISTRY,
)
request_latency_seconds = Histogram(
    "stems_synth_request_latency_seconds",
    "HTTP request latency in seconds.",
    ("route",),
    registry=REGISTRY,
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0),
)
wall_seconds = Histogram(
    "stems_synth_generate_wall_seconds",
    "Wall-clock seconds for /v1/generate-stem.",
    ("preset",),
    registry=REGISTRY,
    buckets=(0.1, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0),
)
model_info = Gauge(
    "stems_synth_model_info",
    "1 when loaded; labels carry version/backend.",
    ("backend", "model_version", "phase"),
    registry=REGISTRY,
)


def set_model_info(
    *, backend: str, model_version: str | None, phase: int, loaded: bool
) -> None:
    model_info.labels(
        backend=backend,
        model_version=model_version or "unset",
        phase=str(phase),
    ).set(1.0 if loaded else 0.0)


def render_metrics() -> tuple[bytes, str]:
    return generate_latest(REGISTRY), CONTENT_TYPE_LATEST
