# ADR 0017 — Prometheus + Grafana observability stack

- Status: Accepted (Sprint 7 — neo-fm v1 finish plan)
- Date: 2026-05-15
- Implements: [ADR 0007](0007-observability-from-phase-1.md)

## Context

ADR 0007 mandated structured JSON logs across all services. Phase 7
(observability) needs that data plus aggregated counters/histograms
queryable in a dashboard. We need:

- p50/p95 inference latency per route + style_family.
- Worker job outcome breakdown (completed / failed_retry / failed_dlq).
- Pre-emption counters tied to ADR 0011's `inference_preempted` taxonomy.
- Per-language vocal-synth failure counts (soft errors from ADR 0015).
- GPU memory + model version state.
- Queue lag (age of the oldest queued job) so backlog is visible.

## Decision

### Exporters

Each service emits Prometheus metrics with a `neofm_<service>_*` prefix
through the standard `prometheus_client` library:

- `services/music-inference/app/metrics.py` — request counter/latency
  histogram, in-flight gauge, model wall-time histogram,
  `gpu_memory_used_mb`, model info.
- `services/vocal-synth/app/metrics.py` — same surface, parallel
  names so dashboards reuse panel templates.
- `services/dgx-worker/app/metrics.py` — embedded HTTP listener
  (not FastAPI; pure stdlib `ThreadingHTTPServer`) on `METRICS_PORT`
  serving `/metrics` + `/healthz`. Surface includes job-outcome
  counters, mixer wall-time, governor pause gauge, queue lag gauge,
  per-language vocal failure counter, and the ADR 0011
  `inference_preempted` counter.

The `/metrics` endpoints are **unauthenticated** by design: only the
docker-compose internal network can reach them (the compose ports are
bound to loopback on the host). If the topology ever changes, gate
`/metrics` behind HMAC like `/v1/*`.

### Prometheus + Grafana profile

`infra/docker-compose.dgx.yml` gains a `monitoring` profile that
brings up:

- `prom/prometheus:v2.55.1` reading `infra/prometheus.yml` and the
  alerting rules at `infra/grafana/alerts.yaml`.
- `grafana/grafana:11.3.0` provisioned from
  `infra/grafana/provisioning/`. The default dashboard is
  `infra/grafana/neo-fm-overview.json`.

Bring it up alongside the rest of the stack:

```
docker compose -f infra/docker-compose.dgx.yml \
  --env-file infra/.env.dgx \
  --profile monitoring up -d
```

The dashboard is the operator's first-stop view. Six stat rows along
the top (jobs completed/failed/preempted, queue lag, in-flight,
governor state) plus six time-series panels (p50/p95 latency, wall
time by style, jobs by outcome, vocal p95 by language, vocal failures,
GPU memory).

### Alert thresholds

`infra/grafana/alerts.yaml` defines four worker alerts, two
music-inference alerts, and one vocal-synth alert. Calibrated for
Phase 1 (30s songs); revisit when Phase 6 ships 60s+ defaults.

| Alert                                | Severity | Rationale                                                      |
| ------------------------------------ | -------- | -------------------------------------------------------------- |
| NeoFmWorkerQueueLagHigh              | warning  | Oldest queued job > 5min → look at the worker or scale out.    |
| NeoFmWorkerJobFailuresElevated       | warning  | >10% failure rate over 15min → investigate root-cause class.   |
| NeoFmWorkerPreemptedBurst            | info     | >3 ADR 0011 preempts in 10min → operator action mis-scheduled? |
| NeoFmWorkerNoCompletionsInWindow     | critical | Backlog growing + zero completions → worker is stuck.          |
| NeoFmMusicInferenceP95Slow           | warning  | /v1/generate p95 > 60s for 10min.                              |
| NeoFmMusicInferenceModelUnloaded     | critical | model_loaded=false for 5min.                                   |
| NeoFmVocalLanguageFailuresElevated   | warning  | One language failing >5x in 15min.                             |

### Healthz upgrade

ADR 0007 §healthz already required `queue_lag_seconds` and
`jobs_in_flight` in healthz. Sprint 7 adds:

- music-inference: `gpu_memory_used_mb` already present; metrics now
  also expose it through Prometheus so the dashboard can chart it
  without parsing healthz.
- dgx-worker: the embedded /healthz endpoint returns `{"status":"ok"}`
  for Prometheus liveness, and the Prometheus exporter exposes the
  worker-level fields (jobs in flight, queue lag) as time series.
- vocal-synth: healthz already reports model state; the prometheus
  exporter adds latency + request counts.

## Consequences

- Every service pulls `prometheus_client>=0.20` as a runtime
  dependency. Adds ~50KB to each image; offsets are well-known.
- The monitoring profile is **opt-in**: bringing up the main stack
  without it is the default operator path. Promote it to
  `--profile monitoring` once SREs need the dashboard.
- Grafana defaults to `admin:admin`. Operators MUST override
  `GRAFANA_ADMIN_PASSWORD` in `infra/.env.dgx` before exposing the
  port to anyone else on the network.
- The `/metrics` route adds a new attack surface if the network
  policy ever loosens. Today: loopback-only on the host, internal
  compose network for service-to-service.
