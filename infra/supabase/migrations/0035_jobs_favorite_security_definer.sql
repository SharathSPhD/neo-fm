-- 0035_jobs_favorite_security_definer.sql -- v1.4 Sprint 1, item 7
--
-- Bug: clicking "Favorite" in the library doesn't persist. The optimistic
-- UI flashes "starred" and reverts on the next render.
--
-- Root cause: `public.toggle_favorite` (migration 0022) was declared
-- `security invoker`, which means it runs with the caller's row-level
-- security context. The `jobs` RLS policy set (migration 0005_rls.sql)
-- grants `authenticated` only SELECT + INSERT — there is no UPDATE
-- policy. The UPDATE inside `toggle_favorite` therefore affects zero
-- rows, the function raises `42501 job_not_found_or_forbidden`, the API
-- returns 403, and the UI reverts.
--
-- Fix: recreate `toggle_favorite` as `security definer` and narrow the
-- UPDATE to the caller's own row via `auth.uid()`. This is the same
-- shape as `enqueue_cover_art_job` (migration 0034): owner check is
-- inside the function body, so RLS does not need an UPDATE policy on
-- `public.jobs` for end users.
--
-- We also tighten the function to:
--   * `set search_path = ''` (security-advisor hygiene; matches 0030 fixes)
--   * raise distinct error codes for "not found" vs "not owner" so the
--     API can tell them apart in future.

drop function if exists public.toggle_favorite(uuid);

create function public.toggle_favorite(p_job_id uuid)
returns table (id uuid, is_favorite boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_new boolean;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select j.user_id into v_owner
    from public.jobs j
   where j.id = p_job_id;

  if v_owner is null then
    raise exception 'job_not_found' using errcode = '42501';
  end if;
  if v_owner <> v_user then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update public.jobs
     set is_favorite = not is_favorite
   where public.jobs.id = p_job_id
     and public.jobs.user_id = v_user
   returning public.jobs.is_favorite into v_new;

  if v_new is null then
    -- Race with a delete between the owner check and the UPDATE; treat
    -- as "gone".
    raise exception 'job_not_found' using errcode = '42501';
  end if;

  return query select p_job_id, v_new;
end;
$$;

revoke execute on function public.toggle_favorite(uuid) from public, anon;
grant execute on function public.toggle_favorite(uuid) to authenticated, service_role;

comment on function public.toggle_favorite(uuid) is
  'v1.4 Sprint 1: toggle jobs.is_favorite for the calling user. SECURITY DEFINER so it does not depend on an UPDATE RLS policy on public.jobs; ownership is enforced inside the body.';
