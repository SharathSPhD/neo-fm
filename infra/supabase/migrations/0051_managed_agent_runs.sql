-- 0051_managed_agent_runs.sql
-- Cloud (Managed Agents) job pipeline: per-job run state and a hard spend ledger
-- for paid third-party calls (Lyria). Written/read only by the service role.

create table if not exists public.agent_runs (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  session_id text,
  agent_key text not null default 'free' check (agent_key in ('free','pro')),
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  lyria_calls integer not null default 0,
  audio_path text,
  lyrics text,
  agent_song_document jsonb,
  updated_at timestamptz not null default now()
);
alter table public.agent_runs enable row level security;
-- No policies: authenticated/anon cannot read or write; service role bypasses RLS.

create table if not exists public.spend_ledger (
  provider text primary key,
  reserved_gbp numeric(10,4) not null default 0 check (reserved_gbp >= 0),
  updated_at timestamptz not null default now()
);
alter table public.spend_ledger enable row level security;

-- Atomic reserve: row-locks the provider row so concurrent workers cannot overshoot the cap.
create or replace function public.reserve_spend(p_provider text, p_amount numeric, p_cap numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_cur numeric;
begin
  insert into public.spend_ledger(provider) values (p_provider) on conflict do nothing;
  select reserved_gbp into v_cur from public.spend_ledger where provider = p_provider for update;
  if v_cur + p_amount > p_cap then
    return false;
  end if;
  update public.spend_ledger set reserved_gbp = v_cur + p_amount, updated_at = now() where provider = p_provider;
  return true;
end $$;

create or replace function public.release_spend(p_provider text, p_amount numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update public.spend_ledger
     set reserved_gbp = greatest(0, reserved_gbp - p_amount), updated_at = now()
   where provider = p_provider;
$$;

revoke all on function public.reserve_spend(text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.release_spend(text, numeric) from public, anon, authenticated;
grant execute on function public.reserve_spend(text, numeric, numeric) to service_role;
grant execute on function public.release_spend(text, numeric) to service_role;
