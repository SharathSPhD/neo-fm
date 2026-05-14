# ADR 0009: Quota window — monthly (not daily) — and tier caps

Status: Accepted

## Context

Two Phase 4 documents disagreed on the free-tier quota for `POST /api/songs`:

1. [`docs/PRD.md`](../PRD.md) §10 (Abuse mitigations) committed to
   **3 songs/month** free tier.
2. The Phase 4 migration
   [`0004_queue.sql`](../../infra/supabase/migrations/0004_queue.sql)
   `public.user_tier_quota()` returns **5/day** free, **50/day** creator,
   **1000/day** pro, paired with
   [`0008_create_song_job.sql`](../../infra/supabase/migrations/0008_create_song_job.sql)
   which compares to `user_jobs_count_today()` — a daily window.

Daily is **30× more generous** than the PRD on the free tier (5/day × 30 ≈
150/month vs. 3/month) and silently shifts the cost story: ADR 0005 caps
free-tier *storage* at 500 MB, which translates to ~50 three-minute MP3s.
A 150/month free generator blows past that cap in two weeks.

The adversarial reviewer surfaced this contradiction explicitly; this ADR
locks the resolution.

## Decision

The job-creation quota window is **monthly**, billed on the calendar UTC
month boundary. Tier caps are:

| Tier    | Free        | Creator     | Pro            |
| ------- | ----------- | ----------- | -------------- |
| Songs / month | **3** | **100** | **1000** |

Implementation:

- `public.user_jobs_count_today(uuid)` is **deprecated** but kept as a
  thin wrapper around the monthly counter so any existing call sites
  fail loud (it returns the monthly count, not the daily one). Migration
  0009 renames the canonical function to `public.user_jobs_count_window`
  and adds a `public.user_jobs_count_month` view-style helper for
  `create_song_job`.
- `public.user_tier_quota(uuid)` is updated in-place via
  `create or replace function` to return the new tier table.
- `public.create_song_job(...)` reads the monthly count under the same
  per-user advisory lock that already protects the existing TOCTOU
  resolution from ADR 0008's sibling investigation.
- The cloud API surface (`POST /api/songs`) is **unchanged**: the
  client-visible error code stays `quota_exceeded`. UX copy on the front
  end is updated separately (Phase 5 work) to read "monthly" instead of
  "today".

The migration that lands this change is idempotent: `create or replace`
overwrites the function bodies, and the function signatures do not
change.

## Consequences

- **Free-tier cost story matches storage:** 3 songs/month × ~10 MB MP3
  fits inside ADR 0005's 500 MB cap with order-of-magnitude headroom for
  retries.
- **Creator tier remains plausible at ~3 songs/day average:**
  100/month is roughly 3/day, in line with the indie-creator persona.
- **Pro tier stays effectively unlimited for v1** at 1000/month; that
  cap exists only to bound DGX-share if a Pro account is compromised.
- **Single source of truth:** the database is the authority on quota.
  Application code reads it via `user_tier_quota()`; UX strings are
  derived from the same table once Phase 5 wires the indicator.
- **Reversible:** if real usage data after launch shows the monthly
  window leaves DGX idle for the back half of each month, ADR 0009b
  can split the cap (e.g. 1/day cap on top of 3/month) without
  schema churn.

## Migration sequence note

This ADR lands as `infra/supabase/migrations/0009_quota_monthly.sql`,
applied after the Phase 4 migrations are already in place. Pre-Phase-4
environments apply 0001..0008 first, then 0009 — no reordering needed.
