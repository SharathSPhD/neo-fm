-- Run against a throwaway database: psql -v ON_ERROR_STOP=1 -f infra/supabase/tests/stripe_webhook_events.sql
do $$ begin create role service_role; exception when duplicate_object then null; end $$; do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
\i infra/supabase/migrations/0065_stripe_webhook_events.sql
do $$ declare r text; begin
  r := public.claim_stripe_event('evt_1', 'x'); assert r = 'claimed', 'first claim: ' || r;
  r := public.claim_stripe_event('evt_1', 'x'); assert r = 'in_flight', 'concurrent: ' || r;
  perform public.release_stripe_event('evt_1');
  r := public.claim_stripe_event('evt_1', 'x'); assert r = 'claimed', 'after release: ' || r;
  perform public.complete_stripe_event('evt_1');
  r := public.claim_stripe_event('evt_1', 'x'); assert r = 'duplicate', 'after complete: ' || r;
  perform public.release_stripe_event('evt_1');
  r := public.claim_stripe_event('evt_1', 'x'); assert r = 'duplicate', 'release must not drop processed: ' || r;
  r := public.claim_stripe_event('evt_2', 'x');
  update public.stripe_webhook_events set received_at = now() - interval '6 minutes' where event_id = 'evt_2';
  r := public.claim_stripe_event('evt_2', 'x'); assert r = 'claimed', 'stale claim reclaimed: ' || r;
  raise notice 'all ok';
end $$;
