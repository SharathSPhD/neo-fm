"""Sprint 7 worker metrics tests.

Avoid binding to a real socket in tests; just exercise the
exposition path and the counter wiring.
"""

from __future__ import annotations

import urllib.request

from prometheus_client import generate_latest

from app import metrics


def test_jobs_total_counter_emits_in_exposition() -> None:
    metrics.jobs_total.labels(outcome="completed").inc()
    metrics.jobs_total.labels(outcome="failed_retry").inc()
    metrics.preempted_total.inc()
    metrics.governor_paused.set(1)
    metrics.queue_lag_seconds.set(42.0)
    metrics.in_flight.set(2)

    body = generate_latest(metrics.REGISTRY).decode()
    assert "neofm_worker_jobs_total" in body
    assert 'outcome="completed"' in body
    assert 'outcome="failed_retry"' in body
    assert "neofm_worker_preempted_total" in body
    assert "neofm_worker_governor_paused 1.0" in body
    assert "neofm_worker_queue_lag_seconds 42.0" in body
    assert "neofm_worker_in_flight 2.0" in body


def test_start_metrics_server_serves_metrics_and_healthz() -> None:
    """Sprint 7: the embedded HTTP listener answers /metrics + /healthz."""
    server = metrics.start_metrics_server(port=0)
    try:
        host, port = server.server_address[:2]
        url = f"http://{host}:{port}"
        with urllib.request.urlopen(f"{url}/healthz", timeout=5) as resp:
            assert resp.status == 200
            assert b'"status":"ok"' in resp.read()
        with urllib.request.urlopen(f"{url}/metrics", timeout=5) as resp:
            assert resp.status == 200
            payload = resp.read().decode()
            assert "neofm_worker_jobs_total" in payload
    finally:
        server.shutdown()
        server.server_close()
