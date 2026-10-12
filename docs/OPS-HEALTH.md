# Ops health summary

Read-only snapshot for the daily health check (08:45 UTC) and for threads that cannot query Supabase directly.

```sh
curl -s -H "Authorization: Bearer $CRON_SECRET" "https://<prod-host>/api/admin/health-summary?format=text"
# -> OK neo-fm 24h: 12 done, 1 failed, 0 queued, 0 processing
# -> ALERT neo-fm 24h: ... | queue stuck: oldest queued job is 14 min old
```

Omit `format=text` for JSON: job counts by status, oldest queued age, failures by code, latency p50/p90/p95/max
(created to finished), diction match by language, Lyria spend ledger and top five users this month, plus `alerts`.
`hours` (1 to 168, default 24) sets the window. Auth is `CRON_SECRET` or `AGENT_TICK_SECRET`; no writes, no new env vars.

Alert thresholds live in `THRESHOLDS` in `apps/web/lib/ops/health-summary.ts`: queue age over 10 min, failure rate over
20% (min 5 jobs), p90 latency over 15 min. `spend_ledger` was also added to the `/api/admin/q` allow-list.
