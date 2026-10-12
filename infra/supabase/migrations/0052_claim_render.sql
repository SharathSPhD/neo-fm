-- 0052_claim_render.sql
-- Atomic render counter: returns the new count, or NULL when the per-run limit is already reached.
-- Independent of any read path, so a stale read can never cause an extra paid render.
create or replace function public.claim_render(p_job_id uuid, p_max integer)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.agent_runs
     set lyria_calls = lyria_calls + 1, updated_at = now()
   where job_id = p_job_id and lyria_calls < p_max
  returning lyria_calls;
$$;
revoke all on function public.claim_render(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_render(uuid, integer) to service_role;
