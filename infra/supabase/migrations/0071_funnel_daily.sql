-- 0071_funnel_daily.sql
-- Privacy-respecting top-of-funnel counters. One row per (day, event) holding a count: no user id, IP, user agent,
-- cookie or referrer is ever stored, so there is nothing personal to export or delete. Later funnel steps (signup,
-- first song, share) are derived from users/jobs and need no tracking at all.

create table if not exists public.funnel_daily (
  day date not null default (now() at time zone 'utc')::date,
  event text not null check (event in ('landing_view','pricing_view','signup_view','share_view')),
  n bigint not null default 0 check (n >= 0),
  primary key (day, event)
);
alter table public.funnel_daily enable row level security;
-- No policies, and Supabase grants ALL on new public tables to anon/authenticated by default, so revoke it: service role only.
revoke all on public.funnel_daily from public, anon, authenticated;

create or replace function public.bump_funnel(p_event text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.funnel_daily(event, n) values (p_event, 1)
  on conflict (day, event) do update set n = public.funnel_daily.n + 1;
$$;

revoke all on function public.bump_funnel(text) from public, anon, authenticated;
grant execute on function public.bump_funnel(text) to service_role;
