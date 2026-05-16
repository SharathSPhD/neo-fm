# orphan-reconciler (Sprint C bug-b)

A cron-triggered Supabase Edge Function that scans
`public.orphan_jobs` (jobs with `status='completed'` but no `tracks`
row, or `status='failed'`) and either re-enqueues them or marks them
`failed` once attempts are exhausted.

## Deploy

```sh
supabase functions deploy orphan-reconciler \
  --project-ref lsxicfgqtdxvlcivlwmd
```

## Configure

In the Supabase dashboard → **Edge Functions → orphan-reconciler →
Secrets**:

```
ORPHAN_RECONCILER_MAX_ATTEMPTS=3
ORPHAN_RECONCILER_GRACE_SECONDS=600
NEO_FM_RECONCILER_SECRET=<random-32-byte-hex>
```

The `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` values are injected
by the Supabase runtime automatically.

## Schedule

In the SQL editor (one-time):

```sql
-- requires pg_cron extension (enabled by default on Supabase free tier)
select cron.schedule(
  'orphan-reconciler-5min',
  '*/5 * * * *',
  $$select net.http_post(
       url:='https://lsxicfgqtdxvlcivlwmd.functions.supabase.co/orphan-reconciler',
       headers:='{"Content-Type":"application/json","Authorization":"Bearer <NEO_FM_RECONCILER_SECRET>"}'::jsonb,
       body:='{}'::jsonb
     ) as request_id;$$
);
```

Disable with `select cron.unschedule('orphan-reconciler-5min');`.

## Manual invoke

```sh
curl -X POST \
  -H "Authorization: Bearer ${NEO_FM_RECONCILER_SECRET}" \
  https://lsxicfgqtdxvlcivlwmd.functions.supabase.co/orphan-reconciler
```

Response: `{ "scanned": N, "recovered": M, "failed_out": K }`.

## Observability

- Edge function logs surface in Supabase Studio → Edge Functions →
  Logs.
- Each invocation prints scan / recover / fail counts. Prometheus
  scrape on the worker side already counts pgmq depth (`queue_lag_seconds`).
- Sprint J adds a Grafana panel `Orphan recoveries / 24h` driven by
  `public.jobs.recovered_at`.
