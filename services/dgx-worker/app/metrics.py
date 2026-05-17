"""Prometheus metrics for the dgx-worker (ADR 0007, Sprint 7).

The worker isn't a FastAPI server, so we expose metrics on a tiny
standalone HTTP listener spawned at process start. The listener is
bound to ``0.0.0.0:METRICS_PORT`` (default 9101); compose maps it
loopback-only on the host, mirroring the music-inference policy.

Metric surface:

  - ``neofm_worker_jobs_total{outcome}``         — counter, outcomes from
    ``JobOutcome``: completed, failed_retry, failed_dlq.
  - ``neofm_worker_inference_seconds``           — histogram of the
    ``inference.generate`` call duration.
  - ``neofm_worker_mix_seconds``                 — histogram of the
    pure-Python mixer wall time.
  - ``neofm_worker_vocal_failures_total{lang}``  — counter of per-lang
    vocal-synth failures (soft errors).
  - ``neofm_worker_governor_paused``             — gauge (0/1).
  - ``neofm_worker_in_flight``                   — gauge of jobs in
    `process_one` right now.
  - ``neofm_worker_queue_lag_seconds``           — gauge sampled by the
    main loop using ``jobs.lease_renewed_at``.
  - ``neofm_worker_preempted_total``             — counter of
    ``inference_preempted`` events (ADR 0011).
"""

from __future__ import annotations

import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from prometheus_client import (
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

LOG = logging.getLogger("neo_fm.dgx_worker.metrics")

REGISTRY = CollectorRegistry()

_LATENCY_BUCKETS = (0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 240, 480)

jobs_total = Counter(
    "neofm_worker_jobs_total",
    "Total jobs processed by outcome.",
    ["outcome"],
    registry=REGISTRY,
)

inference_seconds = Histogram(
    "neofm_worker_inference_seconds",
    "Wall-clock seconds spent in inference.generate.",
    buckets=_LATENCY_BUCKETS,
    registry=REGISTRY,
)

mix_seconds = Histogram(
    "neofm_worker_mix_seconds",
    "Wall-clock seconds spent in the worker-side mixer.",
    buckets=_LATENCY_BUCKETS,
    registry=REGISTRY,
)

vocal_failures_total = Counter(
    "neofm_worker_vocal_failures_total",
    "Per-language vocal-synth call failures (soft errors).",
    ["language"],
    registry=REGISTRY,
)

governor_paused = Gauge(
    "neofm_worker_governor_paused",
    "1 when the governor has paused new pgmq.read calls.",
    registry=REGISTRY,
)

in_flight = Gauge(
    "neofm_worker_in_flight",
    "Number of jobs in process_one right now.",
    registry=REGISTRY,
)

queue_lag_seconds = Gauge(
    "neofm_worker_queue_lag_seconds",
    "Age of the oldest queued job (seconds). Sampled at each main-loop tick.",
    registry=REGISTRY,
)

preempted_total = Counter(
    "neofm_worker_preempted_total",
    "Total inference_preempted (ADR 0011) events.",
    registry=REGISTRY,
)

# v1.3 Sprint 3 — cover-art consumer.
cover_art_jobs_total = Counter(
    "neofm_worker_cover_art_jobs_total",
    "Cover-art jobs processed by outcome.",
    ["outcome"],
    registry=REGISTRY,
)


class _MetricsHandler(BaseHTTPRequestHandler):
    server_version = "neofm-worker-metrics/0.1"

    def do_GET(self) -> None:  # noqa: N802 - http.server expected name
        if self.path not in ("/metrics", "/healthz"):
            self.send_response(404)
            self.end_headers()
            return
        if self.path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return
        payload = generate_latest(REGISTRY)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        # Quiet the stdout spam; the worker's main logger handles
        # request observability and these are scraped frequently.
        LOG.debug(format, *args)


def start_metrics_server(*, port: int, host: str = "0.0.0.0") -> ThreadingHTTPServer:
    """Spawn a daemon HTTP thread serving /metrics + /healthz."""
    server = ThreadingHTTPServer((host, port), _MetricsHandler)
    thread = threading.Thread(
        target=server.serve_forever,
        name="neofm-worker-metrics",
        daemon=True,
    )
    thread.start()
    LOG.info(
        "metrics_server_started",
        extra={"host": host, "port": port},
    )
    return server
