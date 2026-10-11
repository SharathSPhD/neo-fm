-- 0053_users_agent_plan_override.sql
-- Lets an account use a specific agent plan regardless of billing tier (e.g. a showcase account that
-- needs unlimited quota but should only ever render cheap Lyria clips).
alter table public.users add column if not exists agent_plan text check (agent_plan in ('free','pro'));
comment on column public.users.agent_plan is 'Optional override of the tier-derived Managed Agents plan: free (clip only) or pro.';
