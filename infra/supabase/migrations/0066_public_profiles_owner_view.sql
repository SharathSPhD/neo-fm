-- 0066_public_profiles_owner_view.sql  (number pending from lead; see PR description)
-- Threat-model fix T-RLS-3 (docs/SECURITY-THREAT-MODEL.md, issue #38).
--
-- Before: policy users_select_public_handle exposed every row with a handle to anon AND authenticated, and
-- authenticated keeps column SELECT on email/tier/name/agent_plan, so any signed-in user could read other
-- users' email and tier. The public_profiles view was security_invoker, so it depended on that policy.
--
-- After: the view runs as its owner (bypasses RLS) and exposes only (id, handle, created_at); the broad policy
-- is dropped, so users can read only their own users row. Every app read of another user goes through the view
-- (u/[handle], discover). Intentional: Supabase's security_definer_view lint will flag this view; the column
-- list is the access control.

drop policy if exists users_select_public_handle on public.users;

create or replace view public.public_profiles
  with (security_invoker = false)
  as
  select id, handle, created_at
    from public.users
   where handle is not null;

comment on view public.public_profiles is
  'Public slice of public.users (id, handle, created_at). Runs as owner on purpose; the users table itself is own-row only.';

grant select on public.public_profiles to anon, authenticated;
