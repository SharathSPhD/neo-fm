-- 0024_social.sql -- likes, follows, reports (Sprint G)
--
-- Light social layer on top of the share surface (ADR 0013). The
-- design is consciously minimal:
--   - likes: (user_id, job_id) unique. Anonymous likes are not
--     supported in v1.1; you have to be signed in.
--   - follows: (follower_id, followee_id) unique. Self-follow blocked.
--   - reports: free-form report-flag on a public song. Service-role
--     reads only.

create table if not exists public.song_likes (
  user_id uuid not null references public.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create index if not exists song_likes_job_idx
  on public.song_likes (job_id);

comment on table public.song_likes is
  'User -> published song likes. (user_id, job_id) is the natural key.';

alter table public.song_likes enable row level security;

-- Anyone can SELECT to count likes on a public song. Only the user
-- themselves can INSERT/DELETE their like row.
drop policy if exists song_likes_select_all on public.song_likes;
create policy song_likes_select_all on public.song_likes
  for select to anon, authenticated using (true);

drop policy if exists song_likes_insert_own on public.song_likes;
create policy song_likes_insert_own on public.song_likes
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists song_likes_delete_own on public.song_likes;
create policy song_likes_delete_own on public.song_likes
  for delete to authenticated
  using (user_id = auth.uid());

-- Followers ----------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.users(id) on delete cascade,
  followee_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx
  on public.follows (followee_id);

comment on table public.follows is
  'User -> user follow graph. Used for follower counts and (future) feed scoping.';

alter table public.follows enable row level security;

drop policy if exists follows_select_all on public.follows;
create policy follows_select_all on public.follows
  for select to anon, authenticated using (true);

drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows
  for insert to authenticated
  with check (follower_id = auth.uid());

drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows
  for delete to authenticated
  using (follower_id = auth.uid());

-- Reports ------------------------------------------------------------------
create table if not exists public.song_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  reporter_id uuid references public.users(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists song_reports_job_idx
  on public.song_reports (job_id, created_at desc);

comment on table public.song_reports is
  'Abuse reports against published songs. Service-role read; only insert from end users.';

alter table public.song_reports enable row level security;

drop policy if exists song_reports_select_service on public.song_reports;
create policy song_reports_select_service on public.song_reports
  for select to service_role using (true);

drop policy if exists song_reports_insert_auth on public.song_reports;
create policy song_reports_insert_auth on public.song_reports
  for insert to anon, authenticated
  with check (true);

-- Helpers ------------------------------------------------------------------

-- Atomic like / unlike. Returns the new state and updated count.
create or replace function public.toggle_like(p_job_id uuid)
returns table (is_liked boolean, like_count bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existed integer;
  v_count bigint;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  delete from public.song_likes
   where user_id = v_uid and job_id = p_job_id;
  get diagnostics v_existed = row_count;
  if v_existed = 0 then
    insert into public.song_likes (user_id, job_id)
      values (v_uid, p_job_id)
      on conflict do nothing;
  end if;
  select count(*) into v_count
    from public.song_likes where job_id = p_job_id;
  return query select v_existed = 0, v_count;
end;
$$;

revoke execute on function public.toggle_like(uuid) from public;
grant execute on function public.toggle_like(uuid) to authenticated, service_role;

-- Toggle follow. Same shape as toggle_like; returns is_following + count.
create or replace function public.toggle_follow(p_followee uuid)
returns table (is_following boolean, follower_count bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existed integer;
  v_count bigint;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if v_uid = p_followee then
    raise exception 'cannot_follow_self' using errcode = '22023';
  end if;
  delete from public.follows
   where follower_id = v_uid and followee_id = p_followee;
  get diagnostics v_existed = row_count;
  if v_existed = 0 then
    insert into public.follows (follower_id, followee_id)
      values (v_uid, p_followee)
      on conflict do nothing;
  end if;
  select count(*) into v_count
    from public.follows where followee_id = p_followee;
  return query select v_existed = 0, v_count;
end;
$$;

revoke execute on function public.toggle_follow(uuid) from public;
grant execute on function public.toggle_follow(uuid) to authenticated, service_role;

-- Report a song. Anonymous-allowed (reporter_id is nullable).
create or replace function public.report_song(p_job_id uuid, p_reason text)
returns table (id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  if v_reason = '' then
    raise exception 'empty_reason' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    v_reason := left(v_reason, 500);
  end if;
  insert into public.song_reports (job_id, reporter_id, reason)
    values (p_job_id, auth.uid(), v_reason)
    returning song_reports.id into v_id;
  return query select v_id;
end;
$$;

revoke execute on function public.report_song(uuid, text) from public;
grant execute on function public.report_song(uuid, text)
  to anon, authenticated, service_role;
