# Launch checklist

One page of every gate between today and public launch. Status as of 2026-10-12 from `CUTOVER.md`, `MANUAL-STEPS.md`, `STATUS.md` and `EVAL-PCE.md`; re-verify before relying on it. Owner **S** = needs the owner's logins, money or DNS (see MANUAL-STEPS.md for the clicks); **Claude** = done by project sessions. Status: done / open / blocked on S / partial.

## Owner-only (S)
| Gate | Status | Step |
|---|---|---|
| Production on the `neo-fm-prod` Supabase project | done | MANUAL-STEPS 1 |
| Supabase Auth URLs, Google OAuth client and provider | open | MANUAL-STEPS 2 |
| Supabase Pro plan (backups, no pausing) | blocked on S | MANUAL-STEPS 2.4 |
| Stripe test webhook with signing secret in Vercel | open | MANUAL-STEPS 3 |
| Domain neo-fm.com (Vercel + GoDaddy DNS), then app URL, Supabase and Stripe URLs updated | blocked on S | MANUAL-STEPS 4 |
| Rotate `CRON_SECRET` and any key pasted in chat | open | MANUAL-STEPS 6 |
| Upstash Redis for real rate limiting | open | MANUAL-STEPS 8 |
| Stripe live mode: live prices (299 / 799), keys, webhook; Indian-card recurring test (RBI e-mandate) | blocked on S | MANUAL-STEPS 7.1 |
| Grievance mailbox `grievance@neo-fm.com`, `support@` forward, and a named Grievance Officer for /trust and /privacy | blocked on S | CUTOVER |
| Resend key + domain (optional: song-ready email only) | optional | MANUAL-STEPS 5 |

## Technical (Claude)
| Gate | Status |
|---|---|
| Per-IP and per-user limits active (code waits on Upstash); per-user spend envelopes and shared Lyria ceiling | partial: spend done, per-IP needs Upstash |
| Daily spend kill switch and spend-leak monitor | partial: monitor exists; confirm kill switch |
| Stripe webhook idempotent; upgrade, cancel, refund, downgrade tested end to end | open |
| Migration 0029 email trigger repointed to the new project (only if email is wanted) | open |
| Remove dev-only items: `dev_autoconfirm_signups` (dev DB only), `AGENT_TICK_SECRET`, test users (`e2e-bot@neo-fm.test`, showcase users, `delivered@resend.dev`) | open; script only, run with S's go |
| Production cron active (`/api/agent/tick` each minute) and Pro latency acceptable (about 12 min today) | partial |
| Lyria real cost measured from billing; tier quotas and caps retuned (`managed-agents/ECONOMICS.md`) | open |
| Observability: alerts on failure rate, spend vs ceiling, queue age, diction match | partial |
| Accessibility pass on all pages, axe in CI | open |
| Retire the old production Supabase project once unused | open (S) |

## Legal and safety
| Gate | Status |
|---|---|
| Counsel review of /privacy and /terms | blocked on S |
| DPDP consent, account export and deletion flow tested | open |
| Age gate (13+/18+ per counsel) | open |
| Report button, takedown policy, AI labelling, moderation before and after generation | done |
| Moderation audit log and a red-team set for the safety layer | open |

## Quality
| Gate | Status |
|---|---|
| Marketing claim limited to what `EVAL-PCE.md` supports (AI judges, no native panel, prosody behind baseline) | done; keep |
| Native-speaker review of a few songs per language (needed before any stronger claim) | blocked on S |
| Prosody and Kannada improvement experiment (`managed-agents/experiments/kannada-prosody.md`) | proposed, not run |
| Showcase songs seeded through the real pipeline | open |

## Smoke before opening the doors
Playwright suite against the production URL (including the slow create-song journey), one real checkout in test mode, and a look at `agent_runs` for the first jobs.
