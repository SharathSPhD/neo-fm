# ADR 0012: Signed-URL playback for the song detail page

Status: Accepted (2026-05-15; Sprint 2 implementation unblocked)

## Context

Sprint 2 ships M4: a per-song detail page at `/songs/[id]` that shows the
Song Document and lets the user play the rendered audio inline. The
audio bytes live in the `tracks` Supabase Storage bucket; ADR 0005 set
the bucket to **private** with an RLS-backed signed-URL access pattern:

- Server reads `jobs` + `tracks` for `id == :id`. RLS on those tables
  enforces ownership (the user can only read rows where
  `jobs.user_id == auth.uid()`).
- For each track the server calls
  `supabase.storage.from('tracks').createSignedUrl(path, ttl)` and
  returns the URL to the client.
- The `<audio>` element streams from that signed URL directly; bytes
  never pass through the Next.js process.

This works in steady state, but the **shape of the contradiction** is:

| Goal                                            | Force in tension                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| Cheap reads (no signed-URL minted per visit)    | URLs **expire** (signed = TTL'd); a long-open tab returns 403     |
| Per-tab survival of `<audio>` after expiry      | We must mint a fresh URL **on the client** without a page reload  |
| No worker-side state leak                       | URL minting must remain ownership-gated by `auth.uid()`            |
| Cache-friendly server rendering of song details | Detail JSON should be cacheable; signed URL is not                |

The 401/403 path is the interesting one. A signed URL minted at the
top of an hour-long studio session can expire under the user's
fingertip. The naïve fix — set TTL to "really long" — punches a hole in
ADR 0005's whole reason for using signed URLs.

This ADR pins the contradiction explicitly so future contributors do
not regress it.

## Decision

The song detail page uses a **two-tier signed-URL** pattern:

### Tier 1: server-rendered initial mint

The `/songs/[id]` page is a server component. It performs the existing
`GET /api/songs/[id]` call which already mints a 1 hour signed URL
(`SIGNED_URL_TTL_SECONDS = 60 * 60`). That URL is rendered into the
initial HTML. **No client-side fetch needed for the first play.**

This is the cheap fast path: zero round-trips between page-load and the
user clicking play. Works for any session shorter than the TTL.

### Tier 2: on-error refetch

The client-side `<audio>` element registers an `onError` handler. If
the element fires `error` *and* the underlying `MediaError` is
`MEDIA_ERR_NETWORK` or `MEDIA_ERR_SRC_NOT_SUPPORTED` with a 4xx
response, the client calls a **dedicated refresh endpoint** —
`GET /api/songs/[id]/audio-url` — which mints a brand new signed URL,
returns it as JSON, and the client swaps the `src`.

This endpoint:

- Re-runs the same RLS-gated job lookup as the page route. RLS still
  enforces ownership; an attacker cannot mint a URL for a song they
  don't own.
- Returns 404 if the job is `failed` or has no `tracks` row.
- Sets `Cache-Control: no-store` so an intermediate cache cannot serve
  a stale URL.
- Is rate-limited the same as other authenticated endpoints
  (Sprint 4 lands the real edge limiter; until then it inherits the
  middleware shape).

### Why not server-side proxy?

We considered:

- **Streaming bytes through the Next.js process** (i.e. drop signed
  URLs entirely). Killed by ADR 0005's cost model — every play would
  charge a Vercel function invocation + egress, and audio files run
  to several MB each.
- **Set TTL to 24h**. Punches a hole in ADR 0005's
  "URLs out in the wild expire quickly" assumption. Also still
  expires mid-session for users on overnight tabs.
- **Force a full page reload on error**. Loses scroll position,
  loses the play-head, jarring UX. Not acceptable for a music app.

The two-tier mint pattern is the smallest design that keeps URLs
short-lived (TTL = 1h), keeps RLS ownership intact, and lets the page
survive arbitrarily long sessions without a reload.

## Consequences

### Implementation

1. `GET /api/songs/[id]` (existing) keeps the 1h signed URL in its
   payload. The detail page server-component reads this and renders
   `<audio src={track.url} ...>` directly.
2. `GET /api/songs/[id]/audio-url` (new) returns
   `{ url, expires_in_seconds, format, duration_seconds }` with the
   same RLS path. **No body, no side effects beyond minting.**
3. `<SongAudio>` client component wraps `<audio>`. Its `onError`
   handler fetches the refresh endpoint, replaces `src`, and calls
   `.load()` followed by `.play()` if the user was playing.

### Test surface

- **Unit (browser-side)**: an `onError`-driven refetch swaps `src`
  and resumes. Use the existing Vitest + jsdom setup; mock
  `MediaError` and the global `fetch`.
- **Integration**: hitting `/api/songs/[id]/audio-url` for a song
  owned by another user returns 404 (not 403; we don't want to
  leak existence of other users' songs).
- **Manual**: open a song, wait > 1h, hit play — should auto-refresh
  and play without a page reload. Sprint 2 G2 gate covers this end-to-end.

### Operational

- Logs from `/api/songs/[id]/audio-url` should carry
  `{request_id, trace_id, job_id, user_id_hash}` per ADR 0007. A spike
  in refresh-rate per user is a signal we may have an unexpectedly
  short session (or an attacker probing the endpoint).
- TTL is still 1h. Don't lengthen it.

## TRIZ contradiction (C13)

This ADR explicitly resolves contradiction **C13** from
`docs/IMPLEMENTATION_PLAN.md`:

> *Audio URLs should be short-lived for security, but the user's tab
> should not break mid-session.*

The resolution principle is **separation in time** (TRIZ #1): one URL
covers the short lifetime, a thin refresh path covers the long one,
and the boundary between them is the `<audio>` element's own error
event — no polling, no extra state machine.

## References

- [SPEC §5][SPEC] — song detail surface contract.
- [ADR 0005][ADR5] — signed-URL & retention policy.
- [ADR 0007][ADR7] — observability propagation.
- [TRIZ register C13][C13] — short-lived URL vs long sessions.

[SPEC]: ../SPEC.md
[ADR5]: 0005-storage-retention.md
[ADR7]: 0007-observability-from-phase-1.md
[C13]: ../IMPLEMENTATION_PLAN.md
