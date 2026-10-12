-- 0061: v2 monthly song quotas aligned with the value-led price points and the per-user Lyria envelopes (see managed-agents/ECONOMICS.md).
create or replace function public.user_tier_quota(p_user_id uuid)
returns integer
language sql
stable
set search_path to ''
as $$
  select case coalesce(u.tier, 'free'::public.tier_enum)
    when 'free'      then 3
    when 'creator'   then 15
    when 'pro'       then 40
    when 'developer' then 999999
  end
  from public.users u where u.id = p_user_id;
$$;
