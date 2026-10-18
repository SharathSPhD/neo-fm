-- 0105_funnel_campaign_daily.sql
-- DRAFT, NOT APPLIED. Per-campaign funnel counters: one row per (day, event, source, medium, campaign, content) holding a
-- count. Same privacy rules as funnel_daily (0071): the only labels stored are the four utm_* marketing labels (cleaned
-- to short slugs by the app), never a user id, IP, user agent, cookie or referrer. Service role only.
-- Until this is applied /api/events keeps counting the plain funnel and silently drops the campaign counter, and the
-- admin health card shows no campaigns.

create table if not exists public.funnel_campaign_daily (
  day date not null default (now() at time zone 'utc')::date,
  event text not null,
  source text not null default '',
  medium text not null default '',
  campaign text not null default '',
  content text not null default '',
  n bigint not null default 0 check (n >= 0),
  primary key (day, event, source, medium, campaign, content),
  check (char_length(source) <= 40 and char_length(medium) <= 40 and char_length(campaign) <= 40 and char_length(content) <= 40)
);
alter table public.funnel_campaign_daily enable row level security;
revoke all on public.funnel_campaign_daily from public, anon, authenticated;

create or replace function public.bump_funnel_campaign(p_event text, p_source text, p_medium text, p_campaign text, p_content text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.funnel_campaign_daily(event, source, medium, campaign, content, n)
  values (p_event, left(coalesce(p_source, ''), 40), left(coalesce(p_medium, ''), 40), left(coalesce(p_campaign, ''), 40), left(coalesce(p_content, ''), 40), 1)
  on conflict (day, event, source, medium, campaign, content) do update set n = public.funnel_campaign_daily.n + 1;
$$;

revoke all on function public.bump_funnel_campaign(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bump_funnel_campaign(text, text, text, text, text) to service_role;
