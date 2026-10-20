-- Native push (Android FCM) device tokens, next to the browser Web Push subscriptions of 0085.
--   native_push_tokens   one row per installed app. A token is a credential the server later POSTs to FCM with: users get NO
--                        direct access; the API route (service role) is the only reader and writer, like push_subscriptions.
-- notify_user is redefined so a user with only an app token (no browser subscription) also gets their push marked pending.
-- Nothing sends until NEO_FM_NATIVE_PUSH_ENABLED and the FCM service account are set; the web code degrades gracefully
-- while this table is absent. Idempotent.

create table if not exists public.native_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  platform text not null check (platform in ('android')),
  token text not null unique check (length(token) between 20 and 4096),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists native_push_tokens_user_idx on public.native_push_tokens (user_id);

alter table public.native_push_tokens enable row level security;
revoke all on public.native_push_tokens from public, anon, authenticated;
grant all on public.native_push_tokens to service_role;

create or replace function public.notify_user(
  p_user uuid,
  p_type text,
  p_data jsonb default '{}'::jsonb,
  p_dedupe_key text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefs jsonb;
  v_in_app boolean;
  v_push boolean;
  v_mandatory boolean := p_type in ('takedown', 'song_failed');
  v_state text := 'none';
  v_id uuid;
begin
  if p_user is null then
    return null;
  end if;
  select prefs -> p_type into v_prefs from public.notification_prefs where user_id = p_user;
  v_in_app := coalesce((v_prefs ->> 'in_app')::boolean, true);
  if not v_in_app and not v_mandatory then
    return null;
  end if;
  v_push := coalesce((v_prefs ->> 'push')::boolean, p_type in ('song_ready', 'song_failed', 'takedown'));
  if v_push and (
    exists (select 1 from public.push_subscriptions where user_id = p_user)
    or exists (select 1 from public.native_push_tokens where user_id = p_user)
  ) then
    v_state := 'pending';
  end if;
  insert into public.notifications (user_id, type, data, dedupe_key, push_state)
  values (p_user, p_type, coalesce(p_data, '{}'::jsonb), p_dedupe_key, v_state)
  on conflict (user_id, dedupe_key) where dedupe_key is not null and read_at is null
  do update set count = public.notifications.count + 1, data = excluded.data, created_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.notify_user(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.notify_user(uuid, text, jsonb, text) to service_role;
