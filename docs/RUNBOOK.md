# neo-fm RUNBOOK -- operator playbook

> Day-to-day operational playbook. Reproduce-from-scratch steps live
> in `docs/REPRODUCIBILITY.md`. Security incident response lives in
> `docs/SECURITY.md` §7.

Last revised: v1.1 deep-dive, Sprint J.

---

## 0. Read this first

- **The DGX is single-tenant.** A drain is the supported way to
  pause work; never `docker stop` a running worker.
- **Migrations are sequential.** Never edit a migration that has
  been applied to production. Add a new one.
- **Supabase managed is the source of truth for `auth` + `storage`
  + `postgres`.** Do not run destructive SQL outside the MCP
  `apply_migration` path or the dashboard SQL editor.
- **Every change to `infra/` or a migration is followed by a
  Supabase advisor sweep** before merging the PR.

---

## 1. Daily / weekly cadence

| Cadence | Task | Where |
| --- | --- | --- |
| Daily | Spot-check Grafana `neo-fm-overview` for queue lag / failure rate | AMG (prod) or `localhost:3000` in DGX monitoring profile |
| Daily | Skim `public.feedback` for new entries | Supabase dashboard SQL editor: `select * from public.feedback where status='new' order by created_at desc limit 50;` |
| Weekly | Run Supabase advisor (security + performance) | MCP `get_advisors` |
| Weekly | Roll the DGX worker (re-pull weights, re-build images) | `bash scripts/dgx-bootstrap.sh && docker compose ... up -d` |
| Monthly | Rotate `NEO_FM_INTERNAL_HMAC_SECRET` | Vercel env + infra/.env.dgx + `docker compose restart` |
| Quarterly | Restore-from-backup drill | Supabase dashboard -> point-in-time restore to a branch |

---

## 2. Operational toggles

| Action | How |
| --- | --- |
| Pause new generations (planned maintenance) | `python3 scripts/neo-fm-governor.py pause --reason "maintenance"` |
| Drain in-flight work | `python3 scripts/neo-fm-governor.py drain --deadline-seconds 300` |
| Resume | `python3 scripts/neo-fm-governor.py resume` |
| Roll Supabase service-role key | dashboard -> API -> Roll keys. Update Vercel env, redeploy. |
| Disable a user | Supabase dashboard -> Authentication -> Users -> Ban |
| Hide a published song | `update public.published_songs set visibility='unlisted' where public_id='<id>';` |
| Soft-delete a song | `delete from public.jobs where id='<job-id>';` (cascades). User-initiated path: `DELETE /api/songs/[id]`. |
| Mark feedback as triaged | `update public.feedback set status='triaged' where id='<id>';` |

---

## 3. Common alerts and their playbooks

### 3.1 `neo-fm:queue-lag` (Grafana)

**Symptom**: `queue_lag_seconds` > 120s for 5 consecutive minutes.

1. Check `dgx-worker` logs:
   ```sh
   docker compose -f infra/docker-compose.dgx.yml logs --tail=200 dgx-worker
   ```
2. If worker is healthy but slow, check `inference_in_flight` --
   if at cap, scale out (production: add a node to the EKS group;
   v1.1: nothing to do, single DGX).
3. If worker is stuck in `inference_preempted`, the governor is
   paused. Resume it.

### 3.2 `neo-fm:failure-rate` (Grafana)

**Symptom**: `jobs.status='failed'` rate > 2% over 1 hour.

1. Sample the failed rows:
   ```sql
   select id, error, created_at
     from public.jobs
    where status='failed'
      and created_at > now() - interval '1 hour'
    order by created_at desc
    limit 50;
   ```
2. Bucket by `error` (it's structured JSON with `taxonomy`).
3. If the taxonomy is `vocal_backend_unavailable`, the routing
   layer fell off to FakeVocalModel; check vocal-synth logs.
4. If the taxonomy is `lyric_blocked`, the user input hit a
   lyric blocklist -- expected; no action.

### 3.3 `neo-fm:orphans` (synthetic check)

**Symptom**: orphan-reconciler edge function logs a non-zero
recovery count two runs in a row.

1. Look at the recovered jobs:
   ```sql
   select id, status, attempts, created_at, finished_at
     from public.jobs
    where finished_at is null
      and attempts > 1
    order by created_at desc
    limit 50;
   ```
2. If the same `job_id` appears across multiple recoveries, the
   worker is failing transactional audit. Page on dgx-worker and
   pull the worker_audit log lines.

### 3.4 `neo-fm:supabase-degraded` (synthetic)

**Symptom**: `/api/health` returns `checks.supabase.status =
"degraded"` for 2 consecutive minutes.

1. Hit `https://lsxicfgqtdxvlcivlwmd.supabase.co/auth/v1/health`
   directly from a browser.
2. Cross-check on https://status.supabase.com.
3. If Supabase is down, communicate via /help banner -- update
   `apps/web/app/(marketing)/help/page.tsx` and ship.

### 3.5 `neo-fm:vercel-deployment-protection-on-prod` (manual)

**Symptom**: Sign-up email link lands on the app but shows Vercel SSO.

1. Vercel dashboard -> Project -> Settings -> Deployment Protection.
2. Confirm "Standard Protection" is OFF for Production.
3. If it must remain ON (rare), make sure `Bypass for Automation` is
   enabled and the sign-up flow uses that token (v1.2 follow-up).

---

## 4. Standard SQL snippets

All read-only; safe to run from the dashboard SQL editor.

**Active users this week**

```sql
select count(distinct user_id) as wau
  from public.jobs
 where created_at > now() - interval '7 days';
```

**Top 10 styles**

```sql
select sd.style_family, count(*) as jobs
  from public.jobs j
  join public.song_documents sd on sd.id = j.song_document_id
 where j.created_at > now() - interval '30 days'
 group by 1
 order by 2 desc
 limit 10;
```

**Cover-art usage**

```sql
select count(*) as covers,
       count(distinct job_id) as songs,
       round(avg(char_length(prompt)), 1) as avg_prompt_chars
  from public.cover_art
 where created_at > now() - interval '7 days';
```

**Vocal backend distribution**

```sql
select vocal_backend, count(*) as tracks
  from public.tracks
 where created_at > now() - interval '24 hours'
 group by 1
 order by 2 desc;
```

**Stuck jobs (>10 min in `processing`)**

```sql
select id, attempts, started_at, finished_at
  from public.jobs
 where status='processing'
   and started_at < now() - interval '10 minutes'
 order by started_at;
```

---

## 5. Recovery procedures

### 5.1 Recover one stuck job

If a user reports a song that has been stuck in `processing` for
more than 10 minutes:

1. They can click **Recover** in `/library` -- this calls
   `POST /api/songs/[id]/recover` which re-queues the message.
2. As operator you can also call the RPC directly:
   ```sql
   select public.recover_song_job('<job-id>'::uuid);
   ```
3. If the job has `attempts >= 3`, the recover RPC will refuse.
   Either reset attempts (be careful -- this can re-burn quota) or
   advise the user to try again with a new song.

### 5.2 Restore a deleted song (within 30 days)

Supabase managed Postgres has point-in-time recovery (PITR) up to
7 days on Pro, 30 days on Team. Use the dashboard to create a
branch at the appropriate timestamp, export the relevant rows,
re-insert into prod via a migration.

### 5.3 Rebuild the DGX from a kernel crash

```sh
ssh spark-5208
docker compose -f infra/docker-compose.dgx.yml down
git fetch && git checkout main
bash scripts/dgx-bootstrap.sh
docker compose -f infra/docker-compose.dgx.yml \
  --env-file infra/.env.dgx \
  --profile vocal --profile monitoring up -d
```

Then re-run the smoke matrix in `docs/REPRODUCIBILITY.md` §5.

### 5.4 Roll back a bad migration

1. Open the dashboard SQL editor.
2. Manually craft an inverse migration. Tag it
   `00NN_revert_<lastname>.sql`.
3. Apply via MCP `apply_migration` so it lands in
   `infra/supabase/migrations/`.
4. **Never** drop a migration row from the migrations table by
   hand. The CLI uses ordering to compute which migrations to
   apply on the next push.

---

## 6. Owner / on-call (placeholders)

> v1.1 is operated by a single person. Replace this section before
> onboarding a second body.

| Role | Person | Hours | Backup |
| --- | --- | --- | --- |
| DRI | Sharath | best-effort | n/a |
| Web on-call | Sharath | best-effort | n/a |
| DGX on-call | Sharath | best-effort | n/a |
| Database on-call | Sharath | best-effort | Supabase support |

---

## 7. Links

- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Reproducibility: [REPRODUCIBILITY.md](REPRODUCIBILITY.md)
- Production migration: [PRODUCTION-MIGRATION.md](PRODUCTION-MIGRATION.md)
- Security: [SECURITY.md](SECURITY.md)
- Decision records: [DECISIONS/](DECISIONS/)
- Reviews (Sprint A snapshot): [REVIEWS/](REVIEWS/)
- Sprint C auth-callback fix runbook: [RUNBOOKS/sprint-c-auth-callback.md](RUNBOOKS/sprint-c-auth-callback.md)
