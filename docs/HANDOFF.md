# neo-fm handoff (cloud credits ending, 2026-10-12)

For whoever picks this up without the multi-session cloud setup: S alone, a human contractor, or a single local Claude Code / other agent session. Read this first, then [AGENTS.md](../AGENTS.md), [README.md](../README.md) and [STATUS.md](../STATUS.md). Area notes from the project threads are in [docs/handoff/](handoff/) (one file each, written at closure).

Nothing in this file is a secret. Where a secret is needed, it names the place it lives; the values are never in the repo.

## 1. What neo-fm is

India-first AI music platform by Technektar, live at **https://www.neo-fm.com** (bare `neo-fm.com` redirects to `www`). A user describes a song (or writes lyrics) in Hindi, Kannada, Tamil, Telugu, Bengali, Sanskrit or English. Claude Managed Agents plus the PCE cascade write native-script lyrics, Gemini audits the diction, Google Lyria sings it, and the song is stored, shared and played in a PWA.

Plans (Stripe **test mode** until S goes live): Free (3 songs a month), Creator INR 299, Pro INR 799. Quotas and caps live in the database function `user_tier_quota()` and `apps/web/lib/agent/tiers.ts`; the pricing page must match them.

## 2. Where everything runs

| Piece | Where | Notes |
|---|---|---|
| Web app and API | Vercel project `neo-fm-web` (team `ss-projects-f08e52ab`), repo `SharathSPhD/neo-fm`, `apps/web` | `main` auto-deploys to production. Merging is a release. |
| Database, auth, storage | Supabase project `neo-fm-prod` (`kgxltxvjlsnbwomklwox`, Pro plan) | Migrations in `infra/supabase/migrations` (numbered, applied by hand to prod). |
| Worker | Vercel cron `/api/agent/tick` every minute, plus daily `self-improve`, `spend-monitor`, `health-snapshot` (`apps/web/vercel.json`) | No queue service. `lib/agent/process.ts` advances jobs; stuck-job sweeper is `sweeper.ts`. |
| Lyrics | Anthropic Managed Agents (`managed-agents/`), agent ids in Vercel env `MA_AGENT_ID_FREE/PRO`, `MA_ENVIRONMENT_ID` | Anthropic key is `MA_ANTHROPIC_API_KEY`. |
| Audio | Google Lyria through the Gemini API (`lib/agent/lyria.ts`) | Key `GEMINI_API_KEY`. Budget ceiling `LYRIA_BUDGET_GBP` (prod value 40). |
| Diction audit, line timings | Gemini audio understanding (`lib/diction`, `qaDiction`, `qaLineTimings` in `process.ts`) | Best effort, never fails a job. |
| Embeddings | Cloud Run `neo-fm-embedder` (asia-south1), `EMBED_URL` + `EMBED_TOKEN` | Best effort. Unknown whether it was rebuilt after the v2 embed-token change (#73); the app must degrade without it (see open items). |
| Rate limits | Upstash Redis (ap-south-1), `UPSTASH_REDIS_REST_URL/TOKEN` | `/api/health` reports `upstash: ok`. |
| Email | Resend (domain `neo-fm.com`, sender `neo-fm <noreply@neo-fm.com>`) | Supabase edge function `notify-job-complete`, drained every 2 minutes by `pg_cron` through wrappers in migration 0087. Secret lives in Supabase function secrets. |
| Billing | Stripe test mode; webhook `https://www.neo-fm.com/api/billing/webhook` | Secrets `STRIPE_*` in Vercel. |
| DNS and domain | GoDaddy: `A @ 76.76.21.21`, `CNAME www cname.vercel-dns.com`, Resend records on the `send` name | Vercel's "DNS Change Recommended" badge is cosmetic. |
| Grievance contact | `info@technektar.com` (shown on `/trust`, report flows, moderation emails) | No mail forwarding is needed. |

Vercel gotchas: an env var cannot change type once marked Sensitive; `NEXT_PUBLIC_*` must never be Sensitive; env changes need a redeploy; redeploying an old deployment reuses its old commit, so always redeploy the newest `main` build.

Supabase gotchas: SQL over the management API times out at 60 s; DDL touching `jobs`/`users` foreign keys can block on locks, so create tables first, add FKs `NOT VALID` with `lock_timeout`, then `VALIDATE`; `drop policy if exists` can hang; new tables get default grants for `anon`/`authenticated`, so always `revoke` first (CI migration lint enforces this); the `pgmq` schema is not exposed through PostgREST, so use the public security-definer wrappers.

## 3. Secrets and accounts (names only)

All server secrets are in Vercel (Production) and Supabase function secrets: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `MA_ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CREATOR_ID`, `STRIPE_PRICE_PRO_ID`, `EMBED_TOKEN`, Upstash pair, the Resend key. Vercel never shows a saved sensitive value again; to use a secret you must rotate it (generate, paste into Vercel, redeploy). `ADMIN_SECRET` is intentionally unset (admin routes accept `CRON_SECRET`). Optional, unset: web push (`NEO_FM_WEB_PUSH_ENABLED` plus VAPID keys), which stays a no-op.

Accounts S owns: GitHub, Vercel, Supabase, Stripe (test), Anthropic (console), Google Cloud (Gemini, Cloud Run, OAuth client for Google sign-in), Resend, Upstash, GoDaddy, Technektar mail.

Admin routes (`/api/admin/*`) take `Authorization: Bearer <CRON_SECRET>`. `GET /api/admin/health-summary?format=text` is the first thing to look at when something seems wrong.

## 4. Closed manual steps

All items in [MANUAL-STEPS.md](../MANUAL-STEPS.md) are closed or deliberately dropped. Dropped by decision: re-running agent setup (`ma-setup?upgrade=1`, which would remove `web_fetch` from the Pro agent; a hardening nicety, not required) and everything under "before public launch".

## 5. Before going public (not done, S decided not yet)

1. Stripe live mode: live prices (Creator INR 299/month, Pro INR 799/month), live keys, live webhook to the same URL, update Vercel env, redeploy.
2. Delete test users in Supabase Auth: `e2e-bot@neo-fm.test`, `lat-bot@neo-fm.test` (Pro, created for latency tests), `showcase-a`, `showcase-b`, `delivered@resend.dev`, any others.
3. Retire the old Supabase project once nothing uses it.
4. Native-speaker review of songs and translated screens in each language; counsel review of Terms and Privacy (`docs/LEGAL-REVIEW.md` if PR #76 merged).
5. Re-run agent setup so the Pro agent loses `web_fetch` (see section 4).
6. Rotate any secret that ever appeared in chat or logs.
7. Re-confirm the Lyria budget (`LYRIA_BUDGET_GBP`) against actual Google billing; costs in the code are estimates.

## 6. Day-to-day: how work and releases flow

- Branch `claude/<slug>` (or any), PR to `main`, CI green, squash merge. CI jobs: typescript (pnpm), migration security lint, secret scan (gitleaks), managed agents unit + skill drift, pce engine + embedder, song-doc codegen drift, contracts, playwright smoke (includes axe). Merging `main` deploys to production within a couple of minutes.
- Migrations are applied by hand to `neo-fm-prod` **before** merging the PR that needs them; next number = highest on `main` + 1; check open PRs for collisions. Apply big ones in small pieces (section 2 gotchas), then verify.
- Behavior changes need tests that fail without the change. Quality or marketing claims stay inside what `managed-agents/EVAL-PCE.md` supports (AI judges only, no native-speaker panel, prosody behind baseline).
- Spend goes through `reserve_spend` and per-tier caps. Never loop paid calls in tests.
- Moderation fails closed; do not weaken `lib/safety`. No voice cloning, artist imitation or copyrighted lyrics.
- Locally: `pnpm install`, `pnpm -r typecheck`, `pnpm --filter @neo-fm/web test` (about 880 tests), `pnpm --filter @neo-fm/web exec playwright test` for smoke. New UI strings need keys in all six locale files (`apps/web/lib/i18n/locales/{en,hi,ta,te,kn,bn}.ts`); a coverage test fails on missing or unused keys. Next 15: `params`, `searchParams`, `cookies()` and `headers()` are async.

## 7. Production state at closure (2026-10-12)

Working and verified on production: Google and email sign-in, create-song for all tiers, Lyria rendering, diction audit, synced-lyrics timings (`agent_runs.line_timings`, migration 0077), Stripe test checkout and plan updates, DPDP consent flows, rate limiting through Upstash, song-ready emails, collections, charts, language versions (0084 applied), profile bio/avatar, PWA, SEO and ideas gallery, health snapshots and funnel counters (anonymous daily counts only).

Measured:
- Quality (full 60 s lyrics, 15 songs): diction medians Bengali 93, Hindi 92, Kannada 91, Tamil 96, Telugu 96; one real failure (Bengali, lines scrambled); final one or two lines are the most likely to go unsung (see `managed-agents/` quality reports and PR #105/#113).
- Latency (3 Pro 60 s jobs): total 356 s, 405 s and 465 s from queue to done. Stage breakdown is in `agent_runs` telemetry (`stages_ms`); the target was far lower, so latency is the main unsolved engineering item.
- Diction scores vary (70, 75 and 28 in the latency sample), which is what the diction gate (#107, shadow mode) is meant to expose.

Known weak spots: prosody (behind baseline), Kannada evidence is thinnest, Lyria cost per song is modeled not measured, one cron tick is the whole worker (a stuck lease delays every job), no alerting beyond the daily health snapshot.

## 8. Merge queue and open work at closure

Merged this session (all on `main`, production deploys from it): #74 language versions (0084), #80 notifications (0085), #85 recap, #87 Next 15.5 / React 19, #104 line timings (0077), #105 and #106 and #107 and #113 quality work (diction gate runs in shadow mode only), #110 manual steps closed, #114 RLS audit CI plus best-effort embedder, #94 a11y polish, and the area handoff notes in `docs/handoff/`.

Still open, deliberately not merged (decide one by one; none is needed for the live product):

| PR | What | Why not merged |
|---|---|---|
| #45 | Billing hardening (no double subscription, usage meter) | Last to land; merge when CI is green (see closure log). Test-mode billing only. |
| #76 | Legal/DPDP copy pack (draft) | Merge conflicts; needs counsel review anyway. |
| #62 | Creator insights (migration 0078) | Needs migration applied and a privacy check on play counts. |
| #88 | Native-review page (migration 0086, draft) | Needs migration applied; only useful once native reviewers exist. |
| #46 | Review kit (migration 0072, draft) | Same. |
| #56 | Lyrics meaning toggle (migration 0076, draft) | Needs migration applied first. |
| #83 | Visual regression suite | Advisory; regenerate baselines after UI settles. |
| #36, #54, #27, #60, #123 | Prosody experiment, FAQ rewrite, trust evidence, docs nits, quality handoff (drafts) | Not needed for the live product. |
| Dependabot PRs | tailwind 4, typescript 7, vitest 5, actions, docker, python bumps | Major bumps need their own migration work; minor ones are safe to take. |

## 9. Backlog worth doing next (in order)

1. **Latency**: use the stage breakdown to find where 6 to 8 minutes goes (lyrics agent vs Lyria vs QA), then parallelise or trim. Biggest user-facing gap.
2. **Diction gate enforcement**: #107 only records a verdict; add hold or automatic re-render behind a shadow week and a native-speaker check (plan in `managed-agents/DICTION-GATE.md` if merged). Add `DICTION_GATE` kill switch awareness.
3. **Backfill line timings** for older songs: `scripts/quality/line-timings-backfill.mts` (Gemini only, small cost) so every song has synced lyrics.
4. **Lyria spend**: swap the spend guard default to `lyriaBudgetGbp(env)`, hand the render slot back on an expired lease (needs a migration), budget-aware render start, sweeper protection that bumps `agent_runs.updated_at` only on real progress.
5. **Embedder resilience**: confirm Cloud Run embedder accepts v2 embed tokens or redeploy it (`managed-agents/CLOUD-RUN-SETUP.md`); the app must never fail a song because of it.
6. **Quality**: tail-safe polish ("FIT THE CLIP", `managed-agents/` quality notes) needs the production eval gate (`/api/admin/pce-eval`, `self-improve`) before any live change; native-speaker panel.
7. **Observability**: alerting on failure rate, spend vs ceiling, queue age, diction match.
8. Growth ideas deferred by decision: per-channel acquisition source (needs `/privacy` wording first), pricing tests (wait for real billed cost), referral, credit packs, annual plans, UPI AutoPay.

## 10. If something breaks

- Site down or odd: Vercel dashboard > Deployments; roll back by promoting the previous READY production deployment. Check `/api/health` and `/api/admin/health-summary`.
- Songs stuck: [docs/RUNBOOK.md](RUNBOOK.md) section 4; the sweeper and circuit breaker (`lib/agent/sweeper.ts`, `circuit-breaker.ts`) release stale leases and stop spending when Lyria is failing.
- Spend alarm: set `LYRIA_BUDGET_GBP` lower in Vercel and redeploy; `spend-monitor` cron reports daily.
- Emails not sending: Supabase > Edge Functions > `notify-job-complete` logs; `select * from cron.job` for the 2-minute drain.
- Bad migration: restore flow in RUNBOOK section 2 (restore to a new project, never over prod).
- Security: client write grants are stripped except own-row writes; do not add grants without a migration lint pass. `infra/supabase/tests/` has SQL checks; PR #114 adds an RLS audit job if merged.

## 11. Closure log

- Migrations applied to `neo-fm-prod` this session: 0069 through 0075, 0077, 0079 through 0085, 0087 and 0088 (see `infra/supabase/migrations`). Not applied: 0072, 0076, 0078, 0086 (their PRs are open).
- Production verified after the last merge: `/api/health` ok (Supabase and Upstash), sign-in works on Next 15, `/account/notifications` renders.
- The RLS audit job (`scripts/rls-audit.sh`) needs every new table or view classified in `infra/supabase/tests/rls_audit.sql`; migration 0085's tables were added after #114 merged.
- Test accounts to delete before launch: `lat-bot@neo-fm.test` (Pro, latency tests), `e2e-bot@neo-fm.test`, showcase users.
