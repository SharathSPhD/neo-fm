-- 0066_billing_stale_subscription_guard.sql
-- Entitlement bug: a late `customer.subscription.deleted/updated` for an OLD subscription (e.g. the user cancelled
-- sub A, then bought sub B) is applied from Stripe's canonical state for A (canceled), which overwrote user_billing
-- and dropped a paying user to free. A non-paying state for a subscription that is not the one we currently track as
-- paying must not touch the row. A paying state for any subscription still wins (a newer purchase replaces the old).
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
  v_current record;
begin
  if p_user_id is null then
    raise exception 'missing_user_id' using errcode = '22023';
  end if;
  if coalesce(p_stripe_customer_id, '') = '' then
    raise exception 'missing_customer_id' using errcode = '22023';
  end if;

  v_is_paying := p_status in ('active','trialing');

  select stripe_subscription_id, status into v_current
    from public.user_billing where user_id = p_user_id for update;
  if found
     and not v_is_paying
     and v_current.stripe_subscription_id is distinct from p_subscription_id
     and v_current.status in ('active','trialing') then
    return;
  end if;

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
