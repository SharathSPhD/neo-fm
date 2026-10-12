-- 0078_song_listens.sql
-- Anonymous listener events on published songs and the aggregate-only read functions behind /insights.
-- Privacy by design: no user id, no IP, no user agent; `lang` is only the primary language subtag of Accept-Language.
-- Nobody but service_role can read or write the table; creators read through the functions below, which only ever
-- return aggregates for songs they own.

create table if not exists public.song_listens (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind text not null check (kind in ('play', 'share')),
  lang text check (lang is null or lang ~ '^[a-z]{2,3}$'),
  created_at timestamptz not null default now()
);
create index if not exists song_listens_job_created_idx on public.song_listens (job_id, created_at desc);
alter table public.song_listens enable row level security;
revoke all on public.song_listens from public, anon, authenticated;
grant select, insert on public.song_listens to service_role;

-- Per song per day plays, likes and shares for the caller's own songs (sparse: only days with activity).
create or replace function public.creator_insights_daily(p_days int default 30)
returns table (job_id uuid, title text, day date, plays bigint, likes bigint, shares bigint)
language sql stable security definer set search_path = '' as $$
  with win as (select (now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90))) as since),
  mine as (
    select j.id, d.title
      from public.jobs j join public.song_documents d on d.id = j.song_document_id
     where j.user_id = auth.uid()
  ),
  ev as (
    select l.job_id, l.created_at::date as day, l.kind as kind
      from public.song_listens l, win where l.created_at >= win.since and l.job_id in (select id from mine)
    union all
    select k.job_id, k.created_at::date, 'like'
      from public.song_likes k, win where k.created_at >= win.since and k.job_id in (select id from mine)
  )
  select m.id, m.title, e.day,
         count(*) filter (where e.kind = 'play'),
         count(*) filter (where e.kind = 'like'),
         count(*) filter (where e.kind = 'share')
    from ev e join mine m on m.id = e.job_id
   where auth.uid() is not null
   group by m.id, m.title, e.day
   order by e.day, m.id;
$$;

-- Top listener languages across the caller's songs. Returns nothing until the window has at least 5 plays,
-- so a handful of listeners can never be singled out.
create or replace function public.creator_top_languages(p_days int default 30)
returns table (lang text, plays bigint)
language sql stable security definer set search_path = '' as $$
  with plays as (
    select l.lang
      from public.song_listens l join public.jobs j on j.id = l.job_id
     where j.user_id = auth.uid() and l.kind = 'play'
       and l.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90))
  )
  select p.lang, count(*)
    from plays p
   where auth.uid() is not null and p.lang is not null and (select count(*) from plays) >= 5
   group by p.lang
   order by 2 desc, 1
   limit 8;
$$;

-- The caller's best song in the last 7 days: plays + 2 x likes + 3 x shares.
create or replace function public.creator_best_song_week()
returns table (job_id uuid, title text, plays bigint, likes bigint, shares bigint, score bigint)
language sql stable security definer set search_path = '' as $$
  with mine as (
    select j.id, d.title
      from public.jobs j join public.song_documents d on d.id = j.song_document_id
     where j.user_id = auth.uid()
  ),
  agg as (
    select m.id, m.title,
           (select count(*) from public.song_listens l where l.job_id = m.id and l.kind = 'play'  and l.created_at >= now() - interval '7 days') as plays,
           (select count(*) from public.song_likes   k where k.job_id = m.id                      and k.created_at >= now() - interval '7 days') as likes,
           (select count(*) from public.song_listens l where l.job_id = m.id and l.kind = 'share' and l.created_at >= now() - interval '7 days') as shares
      from mine m
  )
  select a.id, a.title, a.plays, a.likes, a.shares, a.plays + 2 * a.likes + 3 * a.shares
    from agg a
   where auth.uid() is not null and a.plays + a.likes + a.shares > 0
   order by 6 desc, a.id
   limit 1;
$$;

-- Supabase grants execute on new functions to anon/authenticated by default; withdraw it before granting back.
revoke all on function public.creator_insights_daily(int) from public, anon, authenticated;
revoke all on function public.creator_top_languages(int) from public, anon, authenticated;
revoke all on function public.creator_best_song_week() from public, anon, authenticated;
grant execute on function public.creator_insights_daily(int) to authenticated;
grant execute on function public.creator_top_languages(int) to authenticated;
grant execute on function public.creator_best_song_week() to authenticated;
