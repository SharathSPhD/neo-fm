-- 0088_funnel_checkout_started.sql
-- Adds one anonymous counter to funnel_daily: clicks on the Upgrade button (checkout_started). Same privacy rules as
-- 0071: a per-day count only, with no user id, tier, IP, cookie or referrer. Only the event check changes; table, RLS,
-- revoked grants and bump_funnel() stay exactly as they were.

alter table public.funnel_daily drop constraint if exists funnel_daily_event_check;
alter table public.funnel_daily add constraint funnel_daily_event_check
  check (event in ('landing_view','pricing_view','signup_view','share_view','checkout_started'));
