# Soft-launch checklist

Target: soft launch before the Claude credit ends on 2026-11-05. Items marked **S** change prod config or prod data and wait for S's go (see [AGENTS.md](../AGENTS.md)); the click-by-click versions are in [MANUAL-STEPS.md](../MANUAL-STEPS.md) section 8.

## Gate: must be done before inviting anyone

| # | Item | Owner | State on main (2026-10-18) |
|---|---|---|---|
| 1 | Delete prod test accounts `lat-bot@neo-fm.test` (Pro), `e2e-bot@neo-fm.test`, `showcase-a`, `showcase-b` | **S** | Still in prod per handover. They hold quota and skew funnel numbers. |
| 2 | Upstash env vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) in Vercel Production | **S** | Without them `lib/rate-limit.ts` falls back to in-process limits, which do not hold across serverless instances. `/api/health` reports upstash reachability once set. |
| 3 | `ADMIN_SECRET` in Vercel Production | **S** | Not referenced on main; it arrives with one of the open PRs. Confirm which PR reads it before setting it. |
| 4 | Supabase leaked-password protection (Auth, Passwords) | **S** | Off. Dashboard toggle, needs the Supabase Pro plan (MANUAL-STEPS step 2.4). |
| 5 | Migrations 0072, 0076, 0078, 0086 applied to `neo-fm-prod` | **S**, after the lead's PR review | Not applied. Each belongs to an open PR (#46, #56, #62/#76, #88); apply only with the PR that needs it. |
| 6 | Embedder (Cloud Run) rebuild | **S** to deploy | Status unknown. The app degrades gracefully without it, so this is not a hard gate; check the service before launch and decide. |
| 7 | Launch-funnel analytics (below) | Claude + **S** for any new vendor | Not instrumented beyond `feedback_events`. |
| 8 | Stripe still in test mode | **S** | Keep test mode for the soft launch unless S decides to charge. Live mode steps are in MANUAL-STEPS section 7. |

## Launch-funnel analytics

What exists on main: `feedback_events` (play_pct, replay, like, dislike, share, download, regenerate, report, abandon), `job_telemetry`, `jobs`, and the read-only `/api/admin/q` endpoint (Bearer `CRON_SECRET`). There is no product-analytics SDK in `apps/web`.

Funnel to track, with the source for each step:

1. Visit: Vercel Web Analytics page views (enable in the Vercel project; no code change needed beyond the `<Analytics />` component).
2. Sign-up: `auth.users` created_at, joined to `users`.
3. First generation started: first row in `jobs` per user.
4. First song completed: `jobs.status = completed`.
5. First play of 30 s or more: `feedback_events` kind `play_pct`.
6. Return within 7 days: second distinct day of `jobs` or `feedback_events`.
7. Paid conversion: `user_billing` tier change.

Proposal for a follow-up PR (not in this one): one SQL view or `scripts/funnel-report.mjs` that computes steps 2 to 7 from existing tables, so no third-party tracker and no extra consent surface is needed. Step 1 needs S to enable Vercel Web Analytics. Anything that adds a third-party tracker needs a DPDP review first ([DPDP-VERIFICATION.md](DPDP-VERIFICATION.md)).

## Spend

`node scripts/spend-report.mjs --out <file>` writes the daily summary. With `ANTHROPIC_ADMIN_KEY` set it reads the Admin API `cost_report` and `usage_report/messages` (GET only); without it, it says billed spend is unavailable and reports only the app ledger. Lyria and Gemini bill separately from the USD 88 Claude credit.

## Verify after S completes the manual steps

- `GET /api/health` shows supabase and upstash ok.
- `/api/admin/q?table=users&select=email` no longer lists the four test accounts.
- Supabase advisors show no leaked-password warning.
