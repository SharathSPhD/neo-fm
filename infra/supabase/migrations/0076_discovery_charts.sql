-- 0076_discovery_charts.sql
-- "Top this week" per language and "song of the day" on Discover / landing.
--
-- One service-role-only function ranks PUBLIC, COMPLETED, playable songs from three signals in a window:
--   like (song_likes), listen (feedback_events play_pct >= 0.7), share (feedback_events share).
-- Anti-gaming, all enforced here rather than in the app:
--   * one contribution per (user, song): like=3, finished listen=1, share=2, summed then capped at 5, so a single
--     account (or script) can't dominate and repeating an action adds nothing;
--   * the song's owner never counts for their own song;
--   * test/automation accounts (example.* / smoke / e2e / test emails) never count;
--   * a song needs >= 2 distinct engaged users to rank at all;
--   * songs with >= 3 abuse reports are excluded (moderation backstop; the existing report flow is the source).
-- Returns no private data: public_id/title/language/style plus aggregate counts. No view is created, and the
-- function is executable by service_role only (called from server components with the service client).
create or replace function public.chart_songs(
  p_language text default null,
  p_days int default 7,
  p_limit int default 10
) returns table (
  public_id text,
  title text,
  language text,
  style_family text,
  likes int,
  listeners int,
  shares int,
  score int
)
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30)) as since,
           least(greatest(coalesce(p_limit, 10), 1), 20) as lim
  ),
  eligible as (
    select j.id as job_id, j.user_id as owner_id, j.public_id, d.title,
           d.language::text as language, d.style_family::text as style_family, j.published_at
    from public.jobs j
    join public.song_documents d on d.id = j.song_document_id
    where j.status = 'completed'
      and j.published_visibility = 'public'
      and j.public_id is not null
      and (p_language is null or d.language::text = p_language)
      and exists (select 1 from public.tracks t where t.job_id = j.id)
      and (select count(*) from public.song_reports r where r.job_id = j.id) < 3
  ),
  signals as (
    select l.job_id, l.user_id, 'like'::text as kind
      from public.song_likes l, params where l.created_at >= params.since
    union all
    select f.job_id, f.user_id, 'listen'
      from public.feedback_events f, params
      where f.kind = 'play_pct' and coalesce(f.value, 0) >= 0.7 and f.created_at >= params.since
    union all
    select f.job_id, f.user_id, 'share'
      from public.feedback_events f, params
      where f.kind = 'share' and f.created_at >= params.since
  ),
  per_user as (
    select s.job_id, s.user_id,
           bool_or(s.kind = 'like') as liked,
           bool_or(s.kind = 'listen') as listened,
           bool_or(s.kind = 'share') as shared
    from signals s
    join eligible e on e.job_id = s.job_id and s.user_id <> e.owner_id
    join public.users u on u.id = s.user_id
    where u.email !~* '(@example\.|^smoke|^e2e|^test)'
    group by s.job_id, s.user_id
  ),
  scored as (
    select p.job_id,
           count(*) filter (where p.liked)::int as likes,
           count(*) filter (where p.listened)::int as listeners,
           count(*) filter (where p.shared)::int as shares,
           count(*)::int as engaged,
           sum(least(5, (case when p.liked then 3 else 0 end)
                       + (case when p.listened then 1 else 0 end)
                       + (case when p.shared then 2 else 0 end)))::int as score
    from per_user p
    group by p.job_id
  )
  select e.public_id, e.title, e.language, e.style_family, s.likes, s.listeners, s.shares, s.score
  from scored s
  join eligible e on e.job_id = s.job_id
  where s.engaged >= 2
  order by s.score desc, e.published_at desc nulls last
  limit (select lim from params);
$$;

revoke all on function public.chart_songs(text, int, int) from public, anon, authenticated;
grant execute on function public.chart_songs(text, int, int) to service_role;
