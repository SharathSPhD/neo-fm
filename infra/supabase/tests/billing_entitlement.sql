-- Run: psql -v ON_ERROR_STOP=1 -f infra/supabase/tests/billing_entitlement.sql  (throwaway database)
-- Minimal stand-ins for the tables/types the RPC touches; the function body is the real 0030 + 0066 text.
create schema if not exists public;
create type public.tier_enum as enum ('free','creator','pro');
create table public.users (id uuid primary key, tier public.tier_enum not null default 'free');
create table public.user_billing (
  user_id uuid primary key references public.users(id) on delete cascade,
  stripe_customer_id text not null, stripe_subscription_id text, stripe_price_id text,
  status text not null default 'inactive', current_period_end timestamptz,
  cancel_at_period_end boolean not null default false
);
\i infra/supabase/migrations/0066_billing_stale_subscription_guard.sql

create or replace function pg_temp.apply(sub text, price text, st text, cancel boolean default false) returns void
language sql as $$ select public.apply_stripe_subscription_state(
  '00000000-0000-0000-0000-000000000001', 'cus_1', sub, price, st, now() + interval '30 days', cancel, 'price_c', 'price_p') $$;
create or replace function pg_temp.expect(label text, want_tier text, want_sub text) returns void language plpgsql as $$
declare t text; s text; begin
  select u.tier::text, b.stripe_subscription_id into t, s from public.users u join public.user_billing b on b.user_id = u.id;
  if t is distinct from want_tier or s is distinct from want_sub then
    raise exception 'FAIL %: tier=% sub=% (want % / %)', label, t, s, want_tier, want_sub; end if;
  raise notice 'ok %', label; end $$;

insert into public.users(id) values ('00000000-0000-0000-0000-000000000001');
select pg_temp.apply('sub_A', 'price_c', 'active');           select pg_temp.expect('checkout -> creator', 'creator', 'sub_A');
select pg_temp.apply('sub_A', 'price_c', 'active');           select pg_temp.expect('replay is a no-op', 'creator', 'sub_A');
select pg_temp.apply('sub_A', 'price_p', 'active');           select pg_temp.expect('upgrade -> pro', 'pro', 'sub_A');
select pg_temp.apply('sub_A', 'price_p', 'active', true);     select pg_temp.expect('cancel at period end keeps pro', 'pro', 'sub_A');
select pg_temp.apply('sub_A', 'price_p', 'past_due');         select pg_temp.expect('payment failed -> free', 'free', 'sub_A');
select pg_temp.apply('sub_A', 'price_p', 'active');           select pg_temp.expect('payment recovered -> pro', 'pro', 'sub_A');
select pg_temp.apply('sub_A', 'price_p', 'canceled');         select pg_temp.expect('cancelled -> free', 'free', 'sub_A');
select pg_temp.apply('sub_B', 'price_c', 'active');           select pg_temp.expect('resubscribe -> creator', 'creator', 'sub_B');
select pg_temp.apply('sub_A', 'price_p', 'canceled');         select pg_temp.expect('late event for old sub is ignored', 'creator', 'sub_B');
select pg_temp.apply('sub_A', 'price_p', 'incomplete_expired'); select pg_temp.expect('stale expired old sub ignored', 'creator', 'sub_B');
select pg_temp.apply('sub_B', 'price_c', 'canceled');         select pg_temp.expect('current sub cancelled -> free', 'free', 'sub_B');
