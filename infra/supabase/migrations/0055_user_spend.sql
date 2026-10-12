-- 0055_user_spend.sql
-- Per-user, per-month spend reservations on top of the global ceiling, so one user can neither exhaust the
-- shared Lyria budget nor exceed their tier's cost envelope. Atomic: both rows are locked in one transaction.

create table if not exists public.user_spend (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  period date not null default date_trunc('month', now())::date,
  reserved_gbp numeric(10,4) not null default 0 check (reserved_gbp >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider, period)
);
alter table public.user_spend enable row level security;
-- No policies: service role only.

create or replace function public.reserve_user_spend(
  p_user uuid, p_provider text, p_amount numeric, p_user_cap numeric, p_global_cap numeric
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_global numeric; v_user numeric; v_period date := date_trunc('month', now())::date;
begin
  insert into public.spend_ledger(provider) values (p_provider) on conflict do nothing;
  insert into public.user_spend(user_id, provider, period) values (p_user, p_provider, v_period) on conflict do nothing;
  -- fixed lock order (global, then user) avoids deadlocks between concurrent reservations
  select reserved_gbp into v_global from public.spend_ledger where provider = p_provider for update;
  select reserved_gbp into v_user from public.user_spend
   where user_id = p_user and provider = p_provider and period = v_period for update;
  if v_global + p_amount > p_global_cap or v_user + p_amount > p_user_cap then
    return false;
  end if;
  update public.spend_ledger set reserved_gbp = v_global + p_amount, updated_at = now() where provider = p_provider;
  update public.user_spend set reserved_gbp = v_user + p_amount, updated_at = now()
   where user_id = p_user and provider = p_provider and period = v_period;
  return true;
end $$;

create or replace function public.release_user_spend(p_user uuid, p_provider text, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_period date := date_trunc('month', now())::date;
begin
  update public.spend_ledger set reserved_gbp = greatest(0, reserved_gbp - p_amount), updated_at = now() where provider = p_provider;
  update public.user_spend set reserved_gbp = greatest(0, reserved_gbp - p_amount), updated_at = now()
   where user_id = p_user and provider = p_provider and period = v_period;
end $$;

revoke all on function public.reserve_user_spend(uuid, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.release_user_spend(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.reserve_user_spend(uuid, text, numeric, numeric, numeric) to service_role;
grant execute on function public.release_user_spend(uuid, text, numeric) to service_role;
