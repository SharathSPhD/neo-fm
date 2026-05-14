-- 0004_queue.sql -- pgmq queues + storage bucket + quota helpers
--
-- ADR 0001: pgmq picked over pg-boss.
-- ADR 0005: tracks bucket private; signed URLs only; 30-day default retention
--           managed by a Phase-11 sweep job.
-- ADR 0008: dead-letter queue is a separate pgmq queue, not a flag column.
--
-- pgmq.create is idempotent: it raises notice but does not error when the
-- queue already exists, so re-applying this migration is safe.

select pgmq.create('song_generation_jobs');
select pgmq.create('song_generation_jobs_dlq');

-- Storage bucket `tracks` (private). Mime allow-list keeps non-audio uploads
-- out at the platform layer; size cap is a defense-in-depth against
-- accidentally generating multi-gigabyte WAVs in a future bug.
insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types, avif_autodetection
) values (
  'tracks',
  'tracks',
  false,
  104857600, -- 100 MB hard cap per object
  array['audio/mpeg','audio/wav','audio/flac','audio/x-wav','audio/mp4'],
  false
) on conflict (id) do nothing;

-- Per-user daily quota helpers used by POST /api/songs (cloud API) before
-- enqueueing. Defaults (free 5 / creator 50 / pro 1000) intentionally land
-- here, not in application code, so quota changes do not require a redeploy.
create or replace function public.user_jobs_count_today(p_user_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::int
  from public.jobs
  where user_id = p_user_id
    and created_at >= date_trunc('day', now() at time zone 'utc');
$$;

create or replace function public.user_tier_quota(p_user_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select case coalesce(u.tier, 'free'::public.tier_enum)
    when 'free'    then 5
    when 'creator' then 50
    when 'pro'     then 1000
  end
  from public.users u where u.id = p_user_id;
$$;
