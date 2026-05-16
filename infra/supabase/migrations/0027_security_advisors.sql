-- 0027_security_advisors.sql -- Sprint I, ADR 0021
--
-- Cleans up the Supabase security advisor findings that landed
-- during Sprints D and G:
--
--   1. `public.recent_vocal_quality` (0018) and `public.public_profiles`
--      (0023) were created as SECURITY DEFINER views, which lets any
--      caller bypass the underlying tables' RLS. Recreate them as
--      SECURITY INVOKER -- both views are intentionally readable, but
--      they should still honour RLS on the rows they expose.
--
--   2. `public.song_reports.song_reports_insert_auth` was `WITH CHECK
--      (true)` -- effectively no-RLS for inserts. Tighten it to:
--
--          - anon may insert iff reporter_id is null
--          - authenticated may insert iff reporter_id = auth.uid()
--
--      That blocks a logged-in user from impersonating a different
--      reporter, and blocks anon from forging a reporter_id.
--
--   3. The handful of `SECURITY DEFINER` functions flagged as callable
--      by `anon`/`authenticated` are intentional: they are the only
--      way the user can mutate the corresponding table (e.g.
--      create_song_job is the *only* way to insert into jobs because
--      direct INSERT is revoked from `authenticated`). We add explicit
--      comments to record that decision so future advisor sweeps
--      don't relitigate it. The leaked-password protection is enabled
--      out-of-band via the Supabase auth settings (see
--      docs/SECURITY.md).
--
-- ADR 0021 owns the long-form rationale.

-- 1. recreate views as SECURITY INVOKER ----------------------------------

drop view if exists public.recent_vocal_quality;
create view public.recent_vocal_quality
  with (security_invoker = true)
  as
  select
    t.created_at,
    j.user_id,
    j.id              as job_id,
    sd.style_family,
    sd.language,
    t.vocal_backend,
    t.vocal_model_version,
    t.vocal_eval_score
  from public.tracks t
  join public.jobs j on j.id = t.job_id
  left join public.song_documents sd on sd.id = j.song_document_id
  where t.vocal_eval_score is not null
  order by t.created_at desc
  limit 500;

comment on view public.recent_vocal_quality is
  'Per-track vocal-synth telemetry. SECURITY INVOKER + RLS gates the rows by job ownership.';

drop view if exists public.public_profiles;
create view public.public_profiles
  with (security_invoker = true)
  as
  select id, handle, created_at
    from public.users
   where handle is not null;

comment on view public.public_profiles is
  'Anonymous-readable subset of public.users. SECURITY INVOKER; the underlying users table has a SELECT policy that exposes (id, handle, created_at) to anon, authenticated when handle is not null.';

grant select on public.public_profiles to anon, authenticated;
grant select on public.recent_vocal_quality to authenticated, service_role;

-- Make sure public.users has a SELECT policy that lets anon read the
-- handle+id+created_at slice. Existing policies likely already cover
-- this for `authenticated` only; widen for `anon` without exposing
-- email / tier (those are still gated by the column-level grants /
-- existing policies).
drop policy if exists users_select_public_handle on public.users;
create policy users_select_public_handle on public.users
  for select to anon, authenticated
  using (handle is not null);

-- 2. tighten song_reports_insert_auth ------------------------------------

drop policy if exists song_reports_insert_auth on public.song_reports;

create policy song_reports_insert_anon on public.song_reports
  for insert to anon
  with check (reporter_id is null);

create policy song_reports_insert_authn on public.song_reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

-- 3. annotate intentional SECURITY DEFINER callable functions -------------

comment on function public.create_song_job(jsonb, public.language_enum, public.style_family_enum, integer, integer, uuid, text) is
  'SECURITY DEFINER -- the only path that can insert into public.jobs (direct INSERT is revoked from authenticated). Quota + storage + advisory lock all live inside. ADR 0008 / 0021.';

comment on function public.publish_song(uuid, text) is
  'SECURITY DEFINER -- mints public_id and toggles published_visibility. Caller checked against auth.uid() inside. ADR 0013 / 0021.';

comment on function public.submit_feedback(text, text, text) is
  'SECURITY DEFINER -- anonymous feedback is allowed (RLS would otherwise reject) and the function trims/bounds input. ADR 0021.';

comment on function public.join_waitlist(text, text, text) is
  'SECURITY DEFINER -- anon must be able to write a waitlist row (RLS on the table is service-role-read-only). Function deduplicates per (lower(email), tier). ADR 0021.';

comment on function public.validate_handle() is
  'SECURITY DEFINER trigger function. Runs at INSERT/UPDATE OF handle on public.users. Pure validation; no privileged access. ADR 0021.';

-- validate_handle is only invoked from the BEFORE trigger on public.users.
-- It must not be callable directly via the REST RPC bridge -- revoke EXECUTE
-- from the anon and authenticated roles so it stops appearing in the
-- security advisor.
revoke execute on function public.validate_handle() from anon, authenticated;
