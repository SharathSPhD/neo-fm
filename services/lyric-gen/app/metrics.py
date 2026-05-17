"""Prometheus metrics for lyric-gen (mirrors cover-art-synth shape)."""

from __future__ import annotations

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

registry = CollectorRegistry()

requests_total = Counter(
    "neofm_lyric_gen_requests_total",
    "Requests handled by lyric-gen, by route + status.",
    labelnames=("route", "status_code"),
    registry=registry,
)

request_latency_seconds = Histogram(
    "neofm_lyric_gen_request_latency_seconds",
    "Request latency seconds.",
    labelnames=("route",),
    buckets=(0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0),
    registry=registry,
)

in_flight = Gauge(
    "neofm_lyric_gen_in_flight",
    "In-flight requests by route.",
    labelnames=("route",),
    registry=registry,
)

wall_seconds = Histogram(
    "neofm_lyric_gen_wall_seconds",
    "Wall-clock seconds spent generating one lyric.",
    labelnames=("backend",),
    buckets=(0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0),
    registry=registry,
)

model_info = Gauge(
    "neofm_lyric_gen_model_info",
    "Active backend; value always 1, labels carry version/backend.",
    labelnames=("backend", "model_version", "phase", "loaded"),
    registry=registry,
)


def set_model_info(
    *, backend: str, model_version: str | None, phase: int, loaded: bool
) -> None:
    model_info.labels(
        backend=backend,
        model_version=model_version or "unknown",
        phase=str(phase),
        loaded="1" if loaded else "0",
    ).set(1.0)


def render_metrics() -> tuple[bytes, str]:
    return generate_latest(registry), CONTENT_TYPE_LATEST
