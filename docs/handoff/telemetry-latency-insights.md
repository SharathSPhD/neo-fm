# Handoff: telemetry, latency, cost and creator insights

## State
- **Stage telemetry** (merged, #28/#31): `job_telemetry.metrics.stages_ms`; views/function from migration 0067 (`job_stage_latency`, `stage_latency_summary`); `scripts/latency-breakdown.mjs`; baseline and ranked plan in `docs/perf/latency-breakdown.md`. Live job progress view is merged.
- **Per-job cost** (PR #62): `metrics.cost = { agent_session, polish, qa, lyria_renders }` via `apps/web/lib/cost/usage.ts` and a ~17-line change in `lib/agent/process.ts`. `scripts/cost-per-song.mjs` applies a prices JSON to stored tokens (uses `agent_session.list_cost` when present) and prints cost per song by plan. No migration.
- **Creator insights** (PR #62): `/insights`, anonymous `POST /api/p/[publicId]/listen` (honours DNT/GPC, skips owner plays, rate limited 30/min), migration `0078_song_listens.sql` (**not applied to prod**). Retention: raw rows 90 days, then rolled into `song_listens_daily` by `purge_song_listens()`, called daily at 03:41 UTC by `/api/admin/purge-listens` (cron entry in `apps/web/vercel.json`). `/privacy` states this.
- **What's new** (PR #62): `/whats-new`, nav badge, entries in `lib/whats-new/entries.ts` (en/hi/ta, other languages fall back to English; wants native review).

## Run and verify locally
- `pnpm -r typecheck`, `pnpm --filter @neo-fm/web lint`, `pnpm --filter @neo-fm/web test`. Needs `harfbuzzjs` installed; without it `share-shape` tests and `lib/share/shape.ts` typecheck fail (sandbox issue, not a code bug).
- Cost: `node scripts/cost-per-song.mjs --help`. Latency: `ADMIN_TOKEN=... node scripts/latency-breakdown.mjs --base <host> --plan pro` or `select * from stage_latency_summary(now()-interval '2 days','pro',240)`.
- 0078: run the whole file in a rolled-back transaction on a scratch DB, then call `purge_song_listens(90)` with seeded old rows (checks raw rows go, daily counts appear).

## Open risks
- 0078 and its new SQL (`song_listens_daily`, `purge_song_listens`) are untested on a database (dev project timed out). Apply to prod only after a rolled-back run.
- Cost only covers what is observed in the tick that finishes the job; polish in an earlier tick is not captured. `agent_session` usage is a best-effort read.
- The 60 s Pro latency target has no measured data yet: the lead is running 3 Pro jobs (S approved up to GBP 1). Burst capacity (10 Pro jobs about 41 min) is the main latency driver and is owned by the lead (#68).
- Translations in What's new and the privacy wording have not had native-speaker review.
- Insights dedications (migration 0074, PR #52) are not yet included.

## Next 3 steps
1. Run 0078 in a rolled-back transaction, then apply to prod and verify `/insights` and the purge cron.
2. Pull `stage_latency_summary` for the 3 Pro 60 s jobs and update `docs/perf/latency-breakdown.md` with measured numbers.
3. Reconcile billed cost: read an AI Studio / Cloud Billing CSV against `metrics.cost` to get real cost per song by tier (extends `scripts/cost-per-song.mjs`).
