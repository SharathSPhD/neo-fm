# ADR 0014 — Quota counts completed-only + concurrent processing cap

- **Status**: accepted
- **Sprint**: 4
- **Owner**: cloud
- **Related**: ADR 0008 (retry/DLQ), ADR 0009 (quota schema), ADR 0013 (publish)

## Context — TRIZ contradiction C14

Two requirements tug against each other:

1. **Forgiving quota.** A user pays for or is allotted "3 songs/month"
   on the free tier. If a DGX outage produces 50 failed jobs, the user
   should not be locked out of their next 3 *real* songs. Otherwise a
   transient platform problem permanently consumes a user's monthly
   allowance, which kills trust.
2. **Anti-abuse capacity protection.** A single user must not be able to
   enqueue a thousand jobs in a single burst, exhaust the worker's VRAM
   budget, and DoS every other user.

Today (`0009_quota_monthly.sql`) the quota counts **every** job created
this month, regardless of status. That satisfies requirement (2) by
accident — the failed/queued jobs counted toward the cap — but violates
requirement (1).

If we naively switch to counting only `completed` jobs we satisfy (1)
but break (2): a malicious user enqueues a thousand jobs, none have
completed yet so the quota check passes every time, and the worker is
swamped.

## Decision

Separate the two concerns into two independent gates inside
`create_song_job` and `create_section_regen_job`:

1. **Monthly quota — count `completed` only.**
   - `user_jobs_count_month(user_id)` returns the count of jobs where
     `status = 'completed' AND finished_at >= date_trunc('month', now() AT TIME ZONE 'utc')`.
   - Tier limits unchanged: free=3, creator=100, pro=1000.
   - Failed / queued / processing jobs do *not* burn allowance.
   - Surfaces as `raise exception 'quota_exceeded' using errcode = '22023'`,
     translated to HTTP `429` (or `422` for legacy callers).

2. **Concurrent-processing cap — count `queued` + `processing`.**
   - New `user_concurrent_processing_count(user_id)` returns the count
     of jobs with `status in ('queued','processing')` for that user.
   - New `user_tier_concurrent_cap(user_id)` returns: free=1, creator=3,
     pro=10.
   - When the count reaches the cap, raise
     `concurrent_cap_exceeded` (errcode `22023`). The route handler
     maps this to HTTP `429` with a different `error` code so the UI
     can show a different message ("you already have N song(s) in
     flight, please wait").

Both gates take the same advisory lock per user so a burst of
concurrent calls is serialized (existing pattern from `0008`).

### Why not a single "in-flight + completed" budget?

We considered counting `completed + queued + processing` so a single
budget covers both. Rejected because:

- It still locks the user out on transient failures: a queued job that
  later fails still burned the budget while it was waiting.
- It conflates two different conversations: "how much do I have left
  this month" vs "am I allowed to fire another request right now".

### Why not just a token bucket?

Token buckets shine at request-per-second pacing. The right abstraction
for *generation* jobs (which take ~30s on GPU) is a counter, not a
bucket. We do plan to add a token-bucket *rate limit* in `middleware.ts`
for the API surface (Sprint 4 separately), but it's a different layer
guarding a different resource (HTTP edge), and complements rather than
replaces these two gates.

## Consequences

### Implementation

1. Migration `0015_quota_completed_only.sql` (applied) rewrites:
   - `user_jobs_count_month` -> completed-only
   - `user_jobs_count_today` -> alias of `_month`
   - new `user_concurrent_processing_count`
   - new `user_tier_concurrent_cap`
   - `create_song_job` -> dual gate (quota + concurrency)
   - `create_section_regen_job` -> dual gate (quota + concurrency)

2. Route handlers map `concurrent_cap_exceeded` -> HTTP `429` with
   `error: "concurrent_cap_exceeded"`. UI surfaces this distinctly
   from `quota_exceeded`.

### Rollback

`0015` only redefines functions (no schema change). Rolling back means
restoring the previous `0009` definitions. Existing rows are unaffected.

### Open questions deferred

- Per-tier monthly quota numbers (3 / 100 / 1000) feel right for v1
  but may need to be reset when pricing lands.
- Concurrent cap of 1 for free tier may be tight if free users are
  encouraged to use section regen heavily. We can lift to 2 once
  Sprint 5's mixer goes live without changing this ADR.
