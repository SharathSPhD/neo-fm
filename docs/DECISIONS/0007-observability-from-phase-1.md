# ADR 0007: Observability lands incrementally, not all in Phase 11

Status: Accepted

## Context

The original plan deferred all observability — Prometheus exporters, Grafana
dashboards, alerting — to Phase 11, after the system was already eight phases
deep into real GPU work, real user data, and real failure modes. By the time
Phase 11 lands, we'd have shipped a dgx-worker, a music-inference container,
a vocal-synth container, and a cloud API without a single structured log or
metric to diagnose why anything fails.

The contradiction (C8): we want observability *cheap* and *late* (one phase,
clean cut) AND we want it *useful* (visible when bugs actually appear, which
is starting now).

## Decision

Split observability across three earlier surfaces, with Phase 11 reserved
for the dashboards + alerts layer that requires multi-service data:

1. **Phase 1: structured JSON logs in `music-inference`.**
   Every request to `/v1/generate` emits one JSON line with `request_id`,
   `model_version`, `gpu_memory_used_mb`, `wall_seconds`, `status`. The
   `/healthz` endpoint reports `model_loaded`, `model_version`,
   `gpu_memory_used_mb`. No metrics endpoint yet, no exporter.

2. **Phase 4: same shape in `dgx-worker` and the cloud API.**
   Worker logs `job_id`, `attempt_id`, `dequeue_lag_ms`, `inference_ms`,
   `upload_ms`, `total_ms`, `status`. Cloud logs `request_id`, `user_id`,
   `route`, `status`, `latency_ms`. All three services emit the same
   `trace_id` (propagated from the cloud → queue message → worker → DGX
   call), so a single song job is one queryable trail.

3. **Phase 11: Prometheus exporters + Grafana dashboards + alert rules.**
   Now there are three services emitting structured logs to draw metrics
   from. Exporters scrape, Grafana dashboards live under `infra/grafana/`,
   alerts wire to a real Slack/email path. This is what Phase 11 actually
   was — *cross-service visualization*, not *the start of observability*.

The `trace_id` schema is locked in Phase 4 (added to
`queue-message.schema.json` as a required `trace_id` field). Earlier phases
use opaque per-service request IDs; Phase 4 introduces the cross-service
join key.

## Consequences

- Phase 1 ships with enough log signal to diagnose model load failures,
  OOMs, and slow inference *on the day they happen*, not 7 phases later.
- The "metrics" work in Phase 11 is reduced to drawing dashboards over
  existing log streams (or running an exporter that summarizes them),
  which is the right scope for a single phase.
- The cost is one schema decision in Phase 4 (`trace_id`) that we cannot
  retrofit cheaply. We accept that.
- This ADR explicitly overrides any earlier doc that says "no
  observability until Phase 11"; SPEC §8 is updated to match.
