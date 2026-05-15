-- 0012_section_regen.sql -- section-level regeneration (M5)
--
-- Sprint 2 adds the ability to regenerate a single section of an already-
-- completed song without redoing the whole composition. The user picks a
-- section on the /songs/[id] detail page, hits "regenerate", and a new
-- job runs against just that section. When it completes, the new section
-- audio is mixed back into the song.
--
-- This migration is **additive**: it leaves all existing columns and
-- functions intact. The detail-page render path and the existing
-- create_song_job RPC continue to work unchanged.
--
-- New surface:
--   1. `jobs.parent_job_id` -- when a regen job is created, this points
--      at the original full-song job. Lets the detail page show the
--      regen history and lets the worker know to mix the new section
--      back into the parent's track.
--   2. `jobs.section_id` -- the Song Document section.id being
--      regenerated. NULL for normal full-song jobs.
--   3. `create_section_regen_job` RPC -- analogous to create_song_job
--      but for the partial case. Enforces:
--        - the parent job is owned by the caller
--        - the parent is `completed` (no partial regen on a half-done job)
--        - the section_id appears in the parent's song_document
--        - the user has remaining monthly quota (regen counts as 1 job)
--      Returns the new job_id + attempt_id.
--   4. Queue payload carries `section_id` and `parent_job_id` so the
--      worker can route to a regen-aware code path. Until Phase 5 lands
--      the real section mixer, the worker can no-op these and the API
--      will surface as "ready for Phase 5". This migration is forward-
--      compatible: enqueuing the message is harmless.

alter table public.jobs
  add column if not exists parent_job_id uuid references public.jobs(id) on delete cascade;

alter table public.jobs
  add column if not exists section_id text;

create index if not exists jobs_parent_job_id_idx
  on public.jobs (parent_job_id) where parent_job_id is not null;

comment on column public.jobs.parent_job_id is
  'Sprint 2 M5: when this job is a section-level regen, points at the original full-song job. NULL for top-level full-song jobs. The detail page reads this to render regen history; the worker reads it to mix the new section back into the parent track.';
comment on column public.jobs.section_id is
  'Sprint 2 M5: the SongDocument section.id this job (re)generates. NULL when the job covers the whole song.';

create or replace function public.create_section_regen_job(
  p_parent_job_id uuid,
  p_section_id text,
  p_attempt_id uuid default null,
  p_trace_id text default null
) returns table (
  job_id uuid,
  parent_job_id uuid,
  section_id text,
  status public.job_status_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_parent record;
  v_used integer;
  v_quota integer;
  v_doc jsonb;
  v_section_found boolean;
  v_new_job_id uuid;
  v_attempt_id uuid := coalesce(p_attempt_id, gen_random_uuid());
  v_trace_id text := coalesce(p_trace_id, gen_random_uuid()::text);
  v_payload jsonb;
  v_section_target integer;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Lock against the user before any state read so concurrent regen
  -- attempts on the same song serialize cleanly.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select j.id,
         j.user_id,
         j.status,
         j.song_document_id,
         sd.document_json,
         sd.language,
         sd.style_family
    into v_parent
    from public.jobs j
    join public.song_documents sd on sd.id = j.song_document_id
   where j.id = p_parent_job_id;

  if v_parent.id is null then
    raise exception 'parent_job_not_found' using errcode = '42704';
  end if;
  if v_parent.user_id <> v_user_id then
    -- Same 404-shaped error as a missing row so we don't leak
    -- existence of other users' jobs through the error message.
    raise exception 'parent_job_not_found' using errcode = '42704';
  end if;
  if v_parent.status <> 'completed' then
    raise exception 'parent_job_not_completed' using errcode = '22023';
  end if;

  v_doc := v_parent.document_json;
  -- Confirm the section_id actually exists in the parent document.
  select exists (
    select 1
    from jsonb_array_elements(v_doc -> 'sections') as s
    where s ->> 'id' = p_section_id
  ),
  (
    select (s ->> 'target_seconds')::integer
    from jsonb_array_elements(v_doc -> 'sections') as s
    where s ->> 'id' = p_section_id
    limit 1
  )
  into v_section_found, v_section_target;

  if not v_section_found then
    raise exception 'section_not_in_document' using errcode = '22023';
  end if;

  v_used := public.user_jobs_count_today(v_user_id);
  v_quota := coalesce(public.user_tier_quota(v_user_id), 5);
  if v_used >= v_quota then
    raise exception 'quota_exceeded' using errcode = '22023';
  end if;

  insert into public.jobs (
    user_id, song_document_id, status, priority, progress,
    attempts, attempt_id, trace_id, parent_job_id, section_id
  )
  values (
    v_user_id, v_parent.song_document_id, 'queued', 0, 0,
    0, v_attempt_id, v_trace_id, p_parent_job_id, p_section_id
  )
  returning id into v_new_job_id;

  v_payload := jsonb_build_object(
    'job_id', v_new_job_id,
    'parent_job_id', p_parent_job_id,
    'section_id', p_section_id,
    'user_id', v_user_id,
    'song_document_id', v_parent.song_document_id,
    'priority', 'normal',
    'created_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'style_family', v_parent.style_family,
    'target_duration_seconds', coalesce(v_section_target, 30),
    'attempt_id', v_attempt_id,
    'attempt_number', 1,
    'trace_id', v_trace_id,
    'is_section_regen', true
  );

  perform public.enqueue_song_generation_job(v_payload);

  return query
    select v_new_job_id,
           p_parent_job_id,
           p_section_id,
           'queued'::public.job_status_enum;
end;
$$;

revoke execute on function public.create_section_regen_job(uuid, text, uuid, text)
  from public, anon;
grant execute on function public.create_section_regen_job(uuid, text, uuid, text)
  to authenticated;

comment on function public.create_section_regen_job(uuid, text, uuid, text) is
  'Sprint 2 M5: atomic section-level regeneration job. Asserts parent ownership + completion, validates the section_id exists in the parent SongDocument, enforces monthly quota, inserts a child jobs row, and enqueues a regen-flagged pgmq message. Phase 5 (vocal-synth / mixer) will wire the worker to mix the regen output back into the parent track; until then the message is enqueued harmlessly.';
