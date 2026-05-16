-- 0030_billing.sql -- Stripe-backed subscription tracking (v1.2 Sprint 5)
--
-- ADR 0023 captures the full rationale; the short version:
--
-- 1. We treat Stripe as the source of truth for "is this user paid?".
-- 2. The neo-fm side is intentionally tiny: one table that mirrors the
--    minimum subscription state we need (customer id, subscription id,
--    price id, status, period end, cancel-at-period-end), and one RPC
--    that the /api/billing/webhook route calls with service-role auth.
-- 3. We do not denormalize "tier" into many places. We keep ONE source
--    of tier truth -- public.users.tier -- and the apply RPC updates it
--    atomically with the user_billing upsert. Quotas continue to read
--    from users.tier so nothing else in the system has to know that
--    Stripe exists.
-- 4. Free users have no row in user_billing. Absence = free.
--
-- The /pricing page already exposes Creator (25 songs/mo, ₹399) and
-- Pro (200 songs/mo, ₹1,499). We harmonize user_tier_quota() with those
-- public commitments while we are here, so test-card upgrades unlock
-- exactly what the pricing page promises.

set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. user_billing -- the per-user Stripe state mirror
-- ---------------------------------------------------------------------------

create table if not exists public.user_billing (
  user_id uuid primary key references public.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  stripe_price_id text,
  status text not null default 'inactive'
    check (status in (
      'trialing','active','past_due','canceled','incomplete',
      'incomplete_expired','unpaid','paused','inactive'
    )),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_billing_stripe_customer_uniq
  on public.user_billing (stripe_customer_id);

create index if not exists user_billing_status_idx
  on public.user_billing (status);

comment on table public.user_billing is
  'ADR 0023: Stripe subscription mirror. One row per paying user. Absence = free tier. The /api/billing/webhook route writes here via apply_stripe_subscription_state() with service-role auth.';

alter table public.user_billing enable row level security;

-- The owning user can read their own row to render the account page.
create policy user_billing_select_own on public.user_billing
  for select to authenticated
  using (user_id = auth.uid());

-- Inserts/updates/deletes go through the RPC under service-role.
-- We do not expose a direct write path to clients.

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger so the column stays honest
-- ---------------------------------------------------------------------------

create or replace function public.tg_user_billing_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- search_path is empty so pin pg_catalog explicitly.
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Trigger functions are not meant to be reached via PostgREST RPC.
-- Revoking from anon/authenticated silences advisor 0028/0029 noise.
revoke execute on function public.tg_user_billing_touch_updated_at()
  from public, anon, authenticated;

drop trigger if exists user_billing_touch_updated_at on public.user_billing;
create trigger user_billing_touch_updated_at
  before update on public.user_billing
  for each row execute function public.tg_user_billing_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. apply_stripe_subscription_state -- the only write path
-- ---------------------------------------------------------------------------
--
-- Called by /api/billing/webhook for these Stripe events:
--   - checkout.session.completed       (first upgrade)
--   - customer.subscription.created    (idempotent reinforcement)
--   - customer.subscription.updated    (plan change, status flip)
--   - customer.subscription.deleted    (cancellation at period end)
--
-- The function:
--   1. Upserts user_billing keyed on user_id.
--   2. Resolves the effective tier from (price_id, status):
--      - active/trialing + Creator price  -> 'creator'
--      - active/trialing + Pro price      -> 'pro'
--      - anything else                    -> 'free'
--   3. Updates public.users.tier in the same transaction.
--
-- Price ids are passed in instead of hard-coded so we can rotate prices
-- without a migration (the price ids live in Vercel env, not the
-- database). The MAPPING is configured per call -- the webhook route is
-- the only place that knows which env var maps to which tier.

create or replace function public.apply_stripe_subscription_state(
  p_user_id uuid,
  p_stripe_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_status text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_creator_price_id text,
  p_pro_price_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier public.tier_enum;
  v_is_paying boolean;
begin
  if p_user_id is null then
    raise exception 'missing_user_id' using errcode = '22023';
  end if;
  if coalesce(p_stripe_customer_id, '') = '' then
    raise exception 'missing_customer_id' using errcode = '22023';
  end if;

  v_is_paying := p_status in ('active','trialing');

  if v_is_paying and p_price_id = p_creator_price_id then
    v_tier := 'creator'::public.tier_enum;
  elsif v_is_paying and p_price_id = p_pro_price_id then
    v_tier := 'pro'::public.tier_enum;
  else
    v_tier := 'free'::public.tier_enum;
  end if;

  insert into public.user_billing (
    user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
    status, current_period_end, cancel_at_period_end
  ) values (
    p_user_id, p_stripe_customer_id, p_subscription_id, p_price_id,
    p_status, p_current_period_end, coalesce(p_cancel_at_period_end, false)
  )
  on conflict (user_id) do update set
    stripe_customer_id      = excluded.stripe_customer_id,
    stripe_subscription_id  = excluded.stripe_subscription_id,
    stripe_price_id         = excluded.stripe_price_id,
    status                  = excluded.status,
    current_period_end      = excluded.current_period_end,
    cancel_at_period_end    = excluded.cancel_at_period_end;

  update public.users set tier = v_tier where id = p_user_id;
end;
$$;

comment on function public.apply_stripe_subscription_state(
  uuid, text, text, text, text, timestamptz, boolean, text, text
) is
  'ADR 0023: the only path that mutates user_billing or users.tier in response to a Stripe event. Called by /api/billing/webhook after signature verification under service-role.';

revoke execute on function public.apply_stripe_subscription_state(
  uuid, text, text, text, text, timestamptz, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription_state(
  uuid, text, text, text, text, timestamptz, boolean, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Harmonize tier quotas with /pricing copy
-- ---------------------------------------------------------------------------
--
-- The /pricing page (Sprint E, v1.1) promises 25 songs/mo on Creator
-- and 200 songs/mo on Pro. The previous SQL caps (100 / 1000) were more
-- generous but invisible -- the UI never let anyone reach them because
-- there was no upgrade path. With v1.2 Sprint 5 wiring real billing,
-- the public commitment becomes the cap.

create or replace function public.user_tier_quota(p_user_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select case coalesce(u.tier, 'free'::public.tier_enum)
    when 'free'    then 3
    when 'creator' then 25
    when 'pro'     then 200
  end
  from public.users u where u.id = p_user_id;
$$;

comment on function public.user_tier_quota(uuid) is
  'ADR 0023 (v1.2): songs-per-month cap aligned with /pricing public commitments. free=3, creator=25, pro=200.';
