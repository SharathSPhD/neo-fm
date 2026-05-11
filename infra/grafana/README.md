# infra/grafana

Dashboards and alert rules land in **Phase 11** (`phase/11-observability` worktree).

Planned artifacts:

- `dashboards/music-inference.json` — model status, GPU memory, latency p50/p95, error rate.
- `dashboards/dgx-worker.json` — queue lag, jobs/min, throttle state.
- `dashboards/cloud-api.json` — request rate, latency, 4xx/5xx, quota hits.
- `alerts/rules.yaml` — GPU util > threshold, job-lag > 60s, HeartMuLa error rate > 1% / 5 min.

Exporters are added to each service in Phase 11 under `/metrics`.
See [docs/SPEC.md](../../docs/SPEC.md) §8.
