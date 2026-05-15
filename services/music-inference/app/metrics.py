"""Prometheus metrics for music-inference (ADR 0007 §observability).

Sprint 7 wires the music-inference service to a Prometheus exporter
so the operator dashboard can observe per-request latency, in-flight
generations, and HeartMuLa model version churn without scraping
JSON logs.

We expose:

  - ``neofm_music_inference_requests_total{route,status_code}`` — counter.
  - ``neofm_music_inference_request_latency_seconds{route}`` — histogram.
  - ``neofm_music_inference_in_flight{route}`` — gauge of concurrent calls.
  - ``neofm_music_inference_wall_seconds`` — histogram of model wall time
    (just for /v1/generate; tagged with style_family).
  - ``neofm_music_inference_model_info`` — info gauge: model_version,
    phase. Set once at startup.
  - ``neofm_music_inference_gpu_memory_mb`` — gauge bumped on each
    /v1/generate (and on /healthz so it's fresh).

The exporter lives at GET /metrics and is **unauthenticated** because
Prometheus scrapes it from the docker-compose network only (the
external port is loopback-bound in compose just like /healthz). If
this service is ever moved off the trusted compose net the scrape
endpoint needs to be HMAC-gated.
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

# Buckets line up with the wall-time targets in PHASE-4-HANDOFF:
# happy path is 4-25s; alerts fire at 30s+.
_LATENCY_BUCKETS = (0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 240, 480)

requests_total = Counter(
    "neofm_music_inference_requests_total",
    "Total HTTP requests by route + status code.",
    ["route", "status_code"],
    registry=REGISTRY,
)

request_latency_seconds = Histogram(
    "neofm_music_inference_request_latency_seconds",
    "Latency of each HTTP request (seconds).",
    ["route"],
    buckets=_LATENCY_BUCKETS,
    registry=REGISTRY,
)

in_flight = Gauge(
    "neofm_music_inference_in_flight",
    "Number of in-flight requests per route.",
    ["route"],
    registry=REGISTRY,
)

wall_seconds = Histogram(
    "neofm_music_inference_wall_seconds",
    "Wall-clock seconds spent inside HeartMuLa per /v1/generate.",
    ["style_family"],
    buckets=_LATENCY_BUCKETS,
    registry=REGISTRY,
)

gpu_memory_mb = Gauge(
    "neofm_music_inference_gpu_memory_mb",
    "Best-effort GPU memory used (MB) sampled on each generate call.",
    registry=REGISTRY,
)

model_info = Info(
    "neofm_music_inference_model",
    "Active HeartMuLa model state.",
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
    """Return (payload, content_type) for the /metrics handler."""
    return generate_latest(REGISTRY), "text/plain; version=0.0.4; charset=utf-8"
