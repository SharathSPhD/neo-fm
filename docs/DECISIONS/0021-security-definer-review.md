# ADR 0021 -- security advisor review (Sprint I)

- Status: accepted
- Date: 2026-05-16
- Authors: Sharath (PM) + agent

## Context

After Sprints D-G we accumulated:

- 2x **SECURITY DEFINER views** flagged by Supabase Advisor:
  `public.recent_vocal_quality` (migration 0018) and
  `public.public_profiles` (migration 0023). SECURITY DEFINER views
  evaluate the view *creator's* RLS, not the caller's -- effectively
  a row-level-security bypass.
- 5x **SECURITY DEFINER functions** callable by `anon` and/or
  `authenticated` (`create_song_job`, `publish_song`, `submit_feedback`,
  `join_waitlist`, `validate_handle`, `recover_song_job`,
  `create_section_regen_job`). These are not bugs -- they're the
  only path the user can mutate the underlying table -- but they
  show up in the advisor every sprint.
- 1x **`rls_policy_always_true`** on `public.song_reports` for
  `INSERT`: `WITH CHECK (true)` lets anyone forge a `reporter_id`.
- 1x **leaked-password protection disabled** on the Supabase Auth
  configuration.

## Decision

### Views: switch to SECURITY INVOKER

Migration 0027 recreates both views with
`WITH (security_invoker = true)`. The exposed columns are
deliberately public (handle, telemetry score), so the view is still
readable; the difference is that RLS on the underlying table
(`public.users` for `public_profiles`, `public.tracks` for
`recent_vocal_quality`) is now honoured.

For `public_profiles` we also widened `public.users` SELECT to
`anon, authenticated using (handle is not null)`. This exposes only
`id`, `handle`, `created_at`; `email`, `tier`, `subscription_id`
remain behind the existing owner-only policy.

### `song_reports` insert policy

Split into two narrower policies:

- `song_reports_insert_anon`: `to anon WITH CHECK (reporter_id is null)`
- `song_reports_insert_authn`: `to authenticated WITH CHECK (reporter_id = auth.uid())`

That preserves the v1.1 product behaviour (anonymous reports allowed)
while blocking forgery in both directions.

### Functions: keep as SECURITY DEFINER, annotate

The advisor lints flag *any* `SECURITY DEFINER` function reachable
from `anon` or `authenticated`. For our functions this is
intentional: every one of them implements a checked write path that
ordinary RLS can't express. Specifically:

| Function | Why DEFINER |
| --- | --- |
| `create_song_job` | Direct INSERT on `jobs` is revoked from `authenticated`. The function owns the quota + storage + advisory lock + pgmq enqueue (ADR 0008). |
| `create_section_regen_job` | Same as above but for section regenerations (ADR 0012). |
| `recover_song_job` | Re-queues orphans owned by the caller; needs `pgmq.send` privilege. |
| `reconciler_recover_job` | Service-role-only (`EXECUTE` revoked from `anon` and `authenticated`). |
| `publish_song` | Mints `public_id` and flips `published_visibility`; owner-checked inside. |
| `submit_feedback` | Inserts into `public.feedback` (anon-allowed); RLS on the table is service-role-read-only. |
| `join_waitlist` | Same as above for `public.waitlist`. |
| `validate_handle` | A `BEFORE INSERT OR UPDATE OF handle` trigger; performs no privileged access of its own. |
| `claim_handle` | SECURITY INVOKER -- not flagged. |
| `toggle_favorite` / `toggle_like` / `toggle_follow` / `rename_song` / `report_song` | SECURITY INVOKER -- not flagged. |

Migration 0027 adds `COMMENT ON FUNCTION` strings spelling the
intent out so the next advisor sweep doesn't re-prompt for the same
discussion.

### Leaked-password protection

Enabled in the Supabase dashboard under
**Authentication -> Policies -> Password security**:

> Block passwords that have appeared in the HaveIBeenPwned breach list.

This is an Auth setting, not a SQL migration. Recorded in
`docs/SECURITY.md`.

## Consequences

- Advisor sweeps after migration 0027 + the dashboard toggle should
  show only the `authenticated_security_definer_function_executable`
  warnings, which are intentional and documented.
- Tightening `song_reports_insert_*` may break an in-development
  client that posts with a forged `reporter_id`. The v1.1 client
  never does that.

## Follow-ups

- v1.2: introduce a sentinel "deleted_user" account so we can
  re-parent published songs on account deletion and not lose the
  share links. Currently deletion cascades.
- v1.2: per-IP rate limit on `submit_feedback` and `join_waitlist`
  via the middleware (Sprint I HTTP hardening).
