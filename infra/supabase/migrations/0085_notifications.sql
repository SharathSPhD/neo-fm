-- 0085_notifications.sql
-- In-app notifications centre + web push.
--
--   notifications        one row per event for a user (song ready/failed, likes, follows, collection adds,
--                        dedications, takedown notices). Repeated events of the same kind on the same target
--                        are folded into one unread row with a counter (dedupe_key) so a popular song doesn't
--                        flood the bell.
--   notification_prefs   per-user, per-type switches {type: {in_app, push}}; absent = defaults (see notify_user).
--   push_subscriptions   browser Web Push endpoints. Endpoints and keys are credentials: users get NO direct
--                        access; the API routes (service role) are the only reader and writer.
--
-- Writes to notifications happen only here (SECURITY DEFINER triggers / notify_user, service role) so users can't
-- forge them; owners read their own rows through RLS and mark them read via an API route. No views are created;
-- default privileges are revoked on every new table and function. Producers never block the write that caused
-- them: trigger bodies swallow errors. Idempotent.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('song_ready', 'song_failed', 'like', 'follow', 'collection_add', 'dedication', 'takedown')),
  data jsonb not null default '{}'::jsonb,
  count int not null default 1 check (count >= 1),
  dedupe_key text,
  -- Web Push delivery state, drained by /api/notifications/push-drain.
  push_state text not null default 'none' check (push_state in ('none', 'pending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index if not exists notifications_push_pending_idx on public.notifications (created_at) where push_state = 'pending';
-- Fold repeats into the open (unread) row; once read, the next event starts a fresh row.
create unique index if not exists notifications_open_dedupe_idx
  on public.notifications (user_id, dedupe_key) where dedupe_key is not null and read_at is null;

create table if not exists public.notification_prefs (
  user_id uuid primary key references public.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.notifications enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists notification_prefs_select_own on public.notification_prefs;
create policy notification_prefs_select_own on public.notification_prefs
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.notifications from public, anon, authenticated;
revoke all on public.notification_prefs from public, anon, authenticated;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant select on public.notification_prefs to authenticated;
grant all on public.notifications to service_role;
grant all on public.notification_prefs to service_role;
grant all on public.push_subscriptions to service_role;

-- The single writer. Applies the user's preferences, folds repeats, and marks the row for push when the user has
-- a subscription and push is on for this type. Types that carry safety or failure information can't be muted
-- in-app. Defaults: in-app on for every type; push on for song_ready, song_failed and takedown only.
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
  if v_push and exists (select 1 from public.push_subscriptions where user_id = p_user) then
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

-- Producers. Each swallows its own errors: a notification problem must never fail a like, a follow or a job update.
create or replace function public.tg_notify_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_public text;
  v_title text;
begin
  select j.user_id, j.public_id, d.title into v_owner, v_public, v_title
    from public.jobs j left join public.song_documents d on d.id = j.song_document_id
   where j.id = new.job_id;
  if v_owner is not null and v_owner <> new.user_id then
    -- Deliberately no liker identity: likes are counted, not attributed.
    perform public.notify_user(v_owner, 'like',
      jsonb_build_object('job_id', new.job_id, 'public_id', v_public, 'title', v_title),
      'like:' || new.job_id::text);
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create or replace function public.tg_notify_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handle text;
begin
  select handle into v_handle from public.users where id = new.follower_id;
  perform public.notify_user(new.followee_id, 'follow', jsonb_build_object('handle', v_handle), 'follow');
  return null;
exception when others then
  return null;
end;
$$;

create or replace function public.tg_notify_job_finished()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
begin
  if new.status in ('completed', 'failed') and new.status is distinct from old.status then
    select title into v_title from public.song_documents where id = new.song_document_id;
    perform public.notify_user(new.user_id,
      case when new.status = 'completed' then 'song_ready' else 'song_failed' end,
      jsonb_build_object('job_id', new.id, 'title', v_title));
  end if;
  return null;
exception when others then
  return null;
end;
$$;

revoke all on function public.tg_notify_like() from public, anon, authenticated;
revoke all on function public.tg_notify_follow() from public, anon, authenticated;
revoke all on function public.tg_notify_job_finished() from public, anon, authenticated;

drop trigger if exists song_likes_notify on public.song_likes;
create trigger song_likes_notify after insert on public.song_likes
  for each row execute function public.tg_notify_like();

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert on public.follows
  for each row execute function public.tg_notify_follow();

drop trigger if exists jobs_inapp_notify on public.jobs;
create trigger jobs_inapp_notify after update of status on public.jobs
  for each row when (new.status in ('completed', 'failed') and old.status is distinct from new.status)
  execute function public.tg_notify_job_finished();

-- Backstop for the per-user subscription cap (the API keeps users at 5 by dropping the oldest; this stops a
-- direct service-role caller or a bug from storing unbounded endpoints). Hard limit 10 per user.
create or replace function public.tg_push_subscription_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.push_subscriptions where user_id = new.user_id) >= 10 then
    raise exception 'push_subscription_limit' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.tg_push_subscription_cap() from public, anon, authenticated;

drop trigger if exists push_subscriptions_cap on public.push_subscriptions;
create trigger push_subscriptions_cap before insert on public.push_subscriptions
  for each row execute function public.tg_push_subscription_cap();
