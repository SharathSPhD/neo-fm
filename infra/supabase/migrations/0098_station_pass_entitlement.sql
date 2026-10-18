-- 0098_station_pass_entitlement.sql: stores the Station pass subscription state (#159 / PR #189).
--
-- Why a separate table: apply_stripe_subscription_state() maps an unknown price to tier 'free', so a pass must never go
-- through it. The pass is its own entitlement, written only by the webhook (service role) and readable by its owner.

set local search_path = public, extensions;

create table if not exists public.station_passes (
  user_id uuid primary key references public.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  stripe_price_id text not null,
  status text not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.station_passes is
  'Station pass subscription mirror. Written only by apply_station_pass_state under service-role (Stripe webhook).';

alter table public.station_passes enable row level security;

revoke all on public.station_passes from public, anon, authenticated;
grant select on public.station_passes to authenticated;

create policy station_passes_select_own on public.station_passes
  for select to authenticated
  using (user_id = auth.uid());

create or replace function public.apply_station_pass_state(
  p_user_id uuid,
  p_stripe_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_status text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or coalesce(p_subscription_id, '') = '' then
    raise exception 'missing_args' using errcode = '22023';
  end if;
  -- Stale-event guard: never move the period end backwards for the same subscription.
  insert into public.station_passes as sp (
    user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_end, cancel_at_period_end
  ) values (
    p_user_id, p_stripe_customer_id, p_subscription_id, p_price_id, p_status, p_current_period_end, p_cancel_at_period_end
  )
  on conflict (user_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_price_id = excluded.stripe_price_id,
    status = excluded.status,
    current_period_end = greatest(sp.current_period_end, excluded.current_period_end),
    cancel_at_period_end = excluded.cancel_at_period_end,
    updated_at = now();
end;
$$;

-- True while the pass is paid up (active/trialing/past_due keep access until Stripe gives up, then canceled/unpaid end it).
create or replace function public.has_station_pass(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.station_passes
    where user_id = p_user_id
      and status in ('active', 'trialing', 'past_due')
      and current_period_end > now()
  );
$$;

revoke all on function public.apply_station_pass_state(uuid, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.has_station_pass(uuid) from public, anon, authenticated;
grant execute on function public.apply_station_pass_state(uuid, text, text, text, text, timestamptz, boolean) to service_role;
grant execute on function public.has_station_pass(uuid) to service_role;

-- Follow-up code (not in this file): the webhook calls apply_station_pass_state instead of skipping the pass price,
-- and the entitlement check gates whatever S decides the pass unlocks (e.g. a monthly personal-render cap).
