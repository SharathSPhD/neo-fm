-- 0065_stripe_webhook_events.sql
-- Idempotent Stripe webhook processing: one row per Stripe event id.
-- Stripe delivers at-least-once and retries on any non-2xx, so the handler claims the event id before applying it.
--   claimed   -> caller owns the event and must call complete_stripe_event (or release_stripe_event on failure)
--   duplicate -> already processed, acknowledge without re-applying
--   in_flight -> another delivery is processing it right now (younger than 5 minutes); caller returns 409 so Stripe retries
-- A claim older than 5 minutes is treated as abandoned (crashed function) and can be re-claimed.
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.stripe_webhook_events enable row level security;
-- No policies: service role only.

create or replace function public.claim_stripe_event(p_event_id text, p_event_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_received timestamptz;
begin
  if coalesce(p_event_id, '') = '' then
    raise exception 'missing_event_id' using errcode = '22023';
  end if;
  insert into public.stripe_webhook_events (event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing;
  if found then
    return 'claimed';
  end if;
  select status, received_at into v_status, v_received
    from public.stripe_webhook_events where event_id = p_event_id for update;
  if v_status = 'processed' then
    return 'duplicate';
  end if;
  if v_received < pg_catalog.now() - interval '5 minutes' then
    update public.stripe_webhook_events set received_at = pg_catalog.now() where event_id = p_event_id;
    return 'claimed';
  end if;
  return 'in_flight';
end;
$$;

create or replace function public.complete_stripe_event(p_event_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.stripe_webhook_events
     set status = 'processed', processed_at = pg_catalog.now()
   where event_id = p_event_id;
$$;

create or replace function public.release_stripe_event(p_event_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.stripe_webhook_events where event_id = p_event_id and status = 'processing';
$$;

revoke execute on function public.claim_stripe_event(text, text) from public, anon, authenticated;
revoke execute on function public.complete_stripe_event(text) from public, anon, authenticated;
revoke execute on function public.release_stripe_event(text) from public, anon, authenticated;
grant execute on function public.claim_stripe_event(text, text) to service_role;
grant execute on function public.complete_stripe_event(text) to service_role;
grant execute on function public.release_stripe_event(text) to service_role;
