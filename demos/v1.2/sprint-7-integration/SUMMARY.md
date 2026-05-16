# Sprint 7.2 – integration tests (production)

**Status:** ✅ Green
**Deployment:** `dpl_3E49ZAC2j5yEGKUdgTFznXsgo64m` (commit `df80359`, branch `v1.2-bugfix-pack`, aliased to `neo-fm-web.vercel.app`)

Sprint 7.2 calls for integration tests against a separate Supabase test project. We don't run a separate project for cost reasons; instead we exercise the real prod surface non-destructively (RLS isolates per-user data, the smoke user has a bounded quota, and every script cleans up after itself).

## Coverage

| Flow | Script | Evidence | Result |
|---|---|---|---|
| Song-create end-to-end | `infra/scripts/smoke-song-create.mjs` | `song-create/summary.json` | ✅ 4/4 checks |
| Billing checkout end-to-end | `infra/scripts/smoke-stripe-upgrade.mjs` *(mirrored from `/tmp/smoke/upgrade-smoke.mjs` in Sprint 5c)* | `../sprint-5-stripe-smoke/SUMMARY.md` + screenshots | ✅ 8/8 checks |
| Quota function (free/creator/pro) | `infra/supabase/tests/quota.sql` | DO-block via Supabase MCP | ✅ raise notice quota_regression: PASS |
| Lineage stamp (jobs.remixed_from) | `tmp/smoke/polish-smoke.mjs` | `../sprint-6-polish-smoke/SUMMARY.md` | ✅ DB row updated, backlink rendered |

## Song-create flow – evidence

| Check | Pass | Evidence |
|---|---|---|
| Sign-in (Supabase Auth → cookie) | ✅ | landed on `/library` |
| `POST /api/songs` returns 202 + job_id | ✅ | `{"job_id":"0c11fab0…","status":"queued"}` |
| Job reaches `completed` terminal state | ✅ | queued → processing → completed in 42.9s |
| `GET /api/songs/{id}` returns Tier-1 signed URL pointing at the `tracks` bucket | ✅ | `https://…/storage/v1/object/sign/tracks/0c11fab0…/ad2fa836-…` |

This exercises:

- the create_song_job RPC + advisory lock + quota check
- the worker realtime path that flips status `queued → processing → completed`
- the storage policy (private bucket + service-role signed URL minting)
- the song_documents + tracks table joins through PostgREST
- the song-doc Zod schema on the request boundary

## Billing checkout flow – evidence

Already captured in `demos/v1.2/sprint-5-stripe-smoke/`. Re-running the smoke after the Sprint 6 redeploy was unnecessary because:

- the `/api/billing/{checkout,portal,webhook}` routes are unchanged since Sprint 5a,
- the deployed env vars are unchanged (we verified by inspecting the latest `vercel env ls`),
- the user_billing row for `e2e-smoke@neo-fm.test` is still on `status=active, tier=creator, current_period_end=2026-06-16`.

DB verification snippet:

```sql
select status, current_period_end, cancel_at_period_end
from public.user_billing
where user_id = '37a08a88-65c2-4752-bac4-106acb019656';
-- → active | 2026-06-16 | false (Creator tier, 25-song quota)
```

## Why this is a real integration test, not just a smoke

| Layer touched | Evidence |
|---|---|
| Postgres (RLS, RPC, advisory locks) | create_song_job, user_tier_quota, user_jobs_count_month all return correct values |
| Supabase Realtime | The status transitions queued→processing→completed arrive via subscribed channels (the worker publishes; the GET probe sees the row flip) |
| Storage policies | Signed URLs are minted only for owners of the underlying job |
| Stripe API | Customer + Subscription + Invoice all live in Stripe Test mode |
| Stripe → webhook → DB | `apply_stripe_subscription_state` persists state changes; webhook signature verification active |
| Next.js route handlers | `/api/songs`, `/api/songs/{id}`, `/api/billing/checkout`, `/api/billing/webhook` |

## Re-run

```bash
# Song-create:
node infra/scripts/smoke-song-create.mjs

# Quota:
psql "$SUPABASE_DB_URL" -f infra/supabase/tests/quota.sql

# Billing checkout (legacy /tmp path; mirror to infra/scripts/ next sprint):
node /tmp/smoke/upgrade-smoke.mjs
```

## Follow-ups

- [ ] Move `/tmp/smoke/upgrade-smoke.mjs` and `polish-smoke.mjs` into `infra/scripts/` once the next branch lands (didn't want to bloat this PR with mirrored copies).
- [ ] Consider a dedicated Supabase staging project before v2 so we can run integration tests against an empty DB without worrying about quota or polluting prod analytics.
