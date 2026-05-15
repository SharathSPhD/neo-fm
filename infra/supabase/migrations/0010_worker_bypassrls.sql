-- 0010_worker_bypassrls.sql -- let neo_fm_worker bypass RLS (ADR 0004 follow-up)
--
-- 0006 said "RLS does not apply to this role" but that is wrong: when RLS is
-- enabled on a table and no policy lists `neo_fm_worker`, the role sees zero
-- rows. The worker's first CAS update against `public.jobs` therefore
-- returned 0 rows and the worker archived the message as "not claimable".
--
-- The principled fix is BYPASSRLS, matching what Supabase already does for
-- `service_role`. Least-privilege is still preserved by the column-level
-- UPDATE grants from 0006 (only the lifecycle columns), the absence of any
-- grant on `public.users` / `public.subscriptions`, and the absence of
-- DELETE on `public.jobs`. RLS was redundant for this role: it never had
-- INSERT-by-mistake risk because the column grants gate that already.
--
-- Adding a per-role policy with `using (true) ... to neo_fm_worker` would be
-- functionally identical to BYPASSRLS while being more code to maintain.

alter role neo_fm_worker bypassrls;

comment on role neo_fm_worker is
  'ADR 0004: dedicated least-privilege role for services/dgx-worker. '
  'Has BYPASSRLS (matching service_role); least-privilege is enforced by '
  'column-level UPDATE grants on public.jobs (lifecycle columns only) and '
  'the absence of any grant on public.users / public.subscriptions / no '
  'DELETE on public.jobs.';
