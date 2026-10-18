-- 0096_funnel_launch_events.sql
-- DRAFT, NOT APPLIED. Widens the funnel_daily event check with the launch-funnel counters: station plays (anonymous vs
-- signed-in), the sign-up nudge shown and clicked, onboarding done, 3+ tracks listened, shares and WhatsApp clicks.
-- Same privacy rules as 0071: a per-day count only, with no user id, IP, cookie or referrer. Only the check changes;
-- table, RLS, revoked grants and bump_funnel() stay exactly as they were. Until this is applied the new beacons are
-- dropped silently (bump_funnel violates the old check, /api/events swallows it) and the admin card shows zeros.

alter table public.funnel_daily drop constraint if exists funnel_daily_event_check;
alter table public.funnel_daily add constraint funnel_daily_event_check
  check (event in (
    'landing_view','pricing_view','signup_view','share_view','checkout_started',
    'station_play_anon','station_play_user','nudge_shown','nudge_clicked','onboarding_done','listened_3','station_share','whatsapp_click'
  ));
