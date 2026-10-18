# neo-fm operations runbook

Audience: whoever is on call (S, the lead session, or a thread acting for them). Everything here is read-only unless a step
says **ACTION**; actions change prod state, so only S or the lead session performs them. Secrets are never pasted into tickets,
chat or commits.

Quick links: health snapshot `docs/OPS-HEALTH.md`; burst findings `docs/CONDUCTOR-BURST.md`; spend/test-user cleanup `apps/web/scripts/`.

## 1. First look (30 seconds)

```sh
curl -s -H "Authorization: Bearer $CRON_SECRET" "https://<prod-host>/api/admin/health-summary?format=text"
```

`OK` = nothing to do. `ALERT ... queue stuck` -> section 4 rows 1 to 4. `failure rate` -> look at failures by code, then the matching row.
The tick runs every minute (Vercel cron `/api/agent/tick`); its JSON response lists per-job results and, since the sweeper, a `swept` map.

## 2. Supabase backup and restore verification

Do this once now and then quarterly; an unrestored backup is a hope, not a backup.

1. Dashboard > project `neo-fm-prod` > Database > Backups. Record: backup type (daily / PITR), newest backup time, retention window. Daily backups come with the paid plans; PITR is an add-on. If the newest backup is older than 26 hours or PITR is off and you want it, that is a finding for S.
2. **Never restore over prod to test.** Restore into a new project (Dashboard > Database > Backups > restore to new project, or create a branch/preview from the backup) and run the checks below against that copy.
3. Row-count and freshness checks, run on prod and on the restored copy, compare:

```sql
select 'jobs' t, count(*) n, max(created_at) newest from jobs
union all select 'tracks', count(*), max(created_at) from tracks
union all select 'agent_runs', count(*), max(updated_at) from agent_runs
union all select 'users', count(*), max(created_at) from users
union all select 'song_documents', count(*), max(created_at) from song_documents;
-- schema is intact: expect the latest migration number you applied
select version from supabase_migrations.schema_migrations order by version desc limit 3;
```

   Pass: counts within the backup's age worth of growth, newest timestamps match the backup time, latest migration version equals prod's.
4. Storage is **not** part of a database backup. Audio objects live in the `tracks` bucket; run `check-audio-integrity.mjs` (section 3) against the restored database to see which rows would point at missing objects. Regenerating a lost song costs a render; decide per song.
5. Record the date, backup used, time to restore, and pass/fail in the ops notes. Delete the restored copy afterwards.

Auth users restore with the database (`auth` schema). API keys, JWT secret and env vars do **not**; the restored project needs its own keys before the app can talk to it.

## 3. Audio storage integrity

Read-only checker: `apps/web/scripts/check-audio-integrity.mjs`.

```sh
cd apps/web
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-audio-integrity.mjs          # text
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-audio-integrity.mjs --json --days=90
```

Exit 0 clean, 1 findings, 2 could not run. It reports:

| Finding | Meaning | What to do |
|---|---|---|
| `MISSING job=... path` | track row (or a completed job's run) points at an object that is not in the bucket; the song plays nothing | Check storage logs for a delete around the job time. If the audio is gone, tell the owner and let them regenerate (it counts a fresh render); do not hand-edit the track row. **ACTION** (S/lead): mark the track `deleted_at` only once the owner has been told. |
| `ORPHAN path` | object nothing references: leaked storage or a render whose finalize never ran | Look up the job id (first path segment). If the job failed or timed out, the file is waste: delete it **ACTION** (S/lead) after confirming no `agent_runs.audio_path` points at it. If the job is stuck at `processing` with audio present, let `finalize` run (next tick) instead of deleting. |
| `NO_TRACK job=...` | completed job with no track row | A finalize insert failed after the job flipped; check tick logs for `tracks insert failed`. **ACTION** (lead): re-run finalize for the job or recreate the row from `agent_runs.audio_path`. |

The script paginates the bucket per job folder, so run it off-hours on large buckets. Scheduling it daily next to the health check is a sensible follow-up; it needs the service role key, so run it from an operator machine or a secret-holding routine, not from a thread without secrets.

## 4. Incident playbook (one row per failure mode we tested)

Tests referenced live in `apps/web/tests/agent-chaos.test.ts`, `lyria-breaker.test.ts`, `sim/`.

| # | Symptom | Confirm (read-only) | Cause and automatic behaviour | Operator action |
|---|---|---|---|---|
| 1 | Job stays `processing` with no progress | health-summary shows long-running; tick response `swept` | The sweeper fails a job only when it is older than 30 min AND its `agent_runs.updated_at` has not moved for 20 min (slow Pro jobs legitimately run close to an hour, so age alone never fails one), with code `timed_out` (user sees "took too long, allowance not used") and releases a leaked Lyria reservation if a render slot was taken with no audio and no error recorded | None normally. If many jobs time out at once, go to row 3 or 5. A job with audio present is left for `finalize`, not failed |
| 2 | Two ticks overlap; worry about double work | `agent_runs` has one row per job; one session | Per-job lease (280 s) in `jobs.agent_lease_until`; `claimStart`/`claimRender` are atomic. A lease from a dead function expires on its own | None. Do **not** clear leases by hand while a tick is running |
| 3 | Lyria 429 / 5xx | tick `trace` lines `render path failed`; `agent_runs.render_error` like `lyria 503` | `generateMusic` retries 3x on one reservation, then releases the reservation. After 3 consecutive outage failures the circuit breaker opens: renders are deferred (no slot, no spend) for 60 s, doubling to 5 min, and one probe closes it again | Check the Gemini/Lyria status page. If an outage keeps jobs without progress for 20+ min (and they are 30+ min old) the sweeper will time them out; tell affected users if it exceeds an hour. Do not raise retry counts |
| 4 | Spend cap errors (`allowance_reached`) | health-summary spend ledger; `LYRIA_BUDGET_GBP` | Atomic reserve against global and per-user caps (`reserve_user_spend`) | If real load, S raises `LYRIA_BUDGET_GBP` **ACTION**. If the ledger looks too high versus completed jobs, suspect a leak: compare `spend_ledger.reserved_gbp` with (completed renders x cost); the daily spend monitor flags stale runs |
| 5 | Jobs fail with "finished without audio" under load | failure code in health-summary; `render_error` empty | Known defect: batch loop + 300 s function deadline can drop a slow render and the retry is refused (see `docs/CONDUCTOR-BURST.md`). Capacity fix is owned by the lead | Re-run the user's song (their allowance is not used on a failed job). Report to the lead with the count |
| 6 | Storage upload fails after a render | tick trace `storage ...`; `render_error` set | The agent gets "Render failed; do not retry"; no track row; the paid render is lost | Check Supabase status and storage limits; the user can retry. Run section 3 afterwards for orphans |
| 7 | Cron not firing (queue age grows, no tick lines) | Vercel > Logs, filter `/api/agent/tick` | Wrong or rotated `CRON_SECRET` gives 401 on every tick | Check section 5 and the deployment's env; verify the 401 body `secret_configured` / `bearer_present` flags |
| 8 | Provider session wedged (agent never calls generate_music) | `/api/admin/ma-session?...` event counts | Sweeper times the job out once it is 30+ min old with no run update for 20 min | If frequent, report to the lead (agent definition or Anthropic incident) |

Escalation order: lead session first (it owns `lib/agent`, prod env vars, migrations), S for money, keys and anything marked **ACTION**.

## 5. CRON_SECRET rotation (doc only; S performs it)

Facts from the code (`apps/web/lib/agent/auth.ts`): every admin and tick route accepts **either** `CRON_SECRET` **or** `AGENT_TICK_SECRET`. Vercel Cron sends `CRON_SECRET` automatically. Use the second secret as a bridge so nothing breaks mid-rotation.

1. Generate a new value locally (`openssl rand -hex 32`); do not paste it into chat, a PR or a thread.
2. In Vercel > Project > Settings > Environment Variables (Production), set `AGENT_TICK_SECRET` to the **new** value. Redeploy production. Both the old `CRON_SECRET` and the new `AGENT_TICK_SECRET` now work.
3. Move every manual caller and routine (daily health check, operator scripts, any thread using the secret) to the new value. Test: `curl -s -H "Authorization: Bearer $NEW" https://<prod-host>/api/admin/health-summary?format=text` returns `OK`/`ALERT`, not 401.
4. Set `CRON_SECRET` to the same new value (or another new one) and redeploy. Vercel Cron picks up the new value with the deployment; the tick keeps working because the deployment's env and the header it sends are the same value.
5. Verify within 2 minutes: Vercel logs show `/api/agent/tick` 200s; health-summary shows no `queue stuck`; the old value now returns 401.
6. Optional: remove `AGENT_TICK_SECRET` if you do not use a second secret; otherwise keep it set to a different, independently rotated value.
7. Rotate on: suspected leak, team change, or every 6 months. Record the date, never the value.

If ticks start 401-ing after step 4: the deployment is on an old env. Redeploy and re-check; fall back by setting `CRON_SECRET` to the previous value (known good) and redeploying.

## 6. Gift-song packs and annual plans (billing, test mode)

- Packs are sellable only while `STRIPE_PRICE_PACK_SINGLE_ID` / `STRIPE_PRICE_PACK_THREE_ID` are set. Keep them **unset in every environment** until migration 0090 is applied to prod: /gift (#128) now spends a credit inside `create_song_job(..., p_use_pack := true)` once the monthly quota is used up, and without 0090 a buyer would pay for credit nothing spends. A pack credit is returned automatically (once per job) when the job it paid for ends `failed` with no audio.
- Before live mode: handle `charge.refunded` (and disputes) by revoking unused pack credit (`song_packs.songs_used = songs_total`) and decide what happens to songs already made. Not implemented; test mode only until then.
- Migration 0089 goes to `neo-fm-prod` only after the PR merges and S says go.
