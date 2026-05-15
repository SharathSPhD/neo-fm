-- 0015_quota_completed_only.sql -- quota counts completed jobs only + concurrent cap (ADR 0014)
--
-- TRIZ Contradiction C14: the current quota counts *every* job ever
-- created this month, including queued/processing/failed. That means a
-- single transient DGX outage (50+ failed jobs) could permanently lock a
-- free-tier user out for the rest of the month, even though no real work
-- happened. At the same time, simply counting `completed` would let a
-- user enqueue a thousand jobs in a single burst, exceed the DGX VRAM
-- budget, and DoS the worker.
--
-- Resolve by separating the two concerns:
--
--   1. Quota (monthly budget, billing): count only `completed` jobs
--      this month. Failed/queued/processing don't burn the user's
--      monthly allowance, matching the user's intuition ("I get 3
--      songs/month").
--
--   2. Concurrency cap (anti-abuse, capacity protection): cap the
--      number of `queued` + `processing` jobs a user can have in
--      flight at once. Free=1, Creator=3, Pro=10. Submitting a 4th
--      job while 3 are in flight raises `concurrent_cap_exceeded`.
--
-- This migration is additive: existing rows are unaffected. We rewrite
-- user_jobs_count_today/month and create_song_job / create_section_regen_job
-- in place.
--
-- ADR 0014 owns the rationale.

-- 1. Quota function: count completed jobs in the current calendar month.
create or replace function public.user_jobs_count_month(p_user_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int
  from public.jobs
  where user_id = p_user_id
    and status = 'completed'
    and finished_at >= date_trunc('month', now() at time zone 'utc');
$$;

-- Keep _today as an alias for backwards compatibility. Same semantics
-- (count completed jobs this calendar month). Other code calls _today.
create or replace function public.user_jobs_count_today(p_user_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select public.user_jobs_count_month(p_user_id);
$$;

-- 2. Concurrent-processing cap: queued + processing jobs in flight.
create or replace function public.user_concurrent_processing_count(p_user_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int
  from public.jobs
  where user_id = p_user_id
    and status in ('queued', 'processing');
$$;

-- 3. Per-tier concurrent cap. Mirrors user_tier_quota shape.
create or replace function public.user_tier_concurrent_cap(p_user_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select case coalesce(u.tier, 'free'::public.tier_enum)
    when 'free'    then 1
    when 'creator' then 3
    when 'pro'     then 10
  end
  from public.users u where u.id = p_user_id;
$$;

revoke all on function public.user_concurrent_processing_count(uuid) from public;
grant execute on function public.user_concurrent_processing_count(uuid)
  to authenticated, service_role;
revoke all on function public.user_tier_concurrent_cap(uuid) from public;
grant execute on function public.user_tier_concurrent_cap(uuid)
  to authenticated, service_role;

-- 4. create_song_job: enforce both quota (completed) + concurrent cap.
create or replace function public.create_song_job(
  p_song_document jsonb,
  p_language public.language_enum,
  p_style_family public.style_family_enum,
  p_target_duration_seconds integer,
  p_priority integer default 0,
  p_attempt_id uuid default null,
  p_trace_id text default null
)
returns table(
  job_id uuid,
  song_id uuid,
  status public.job_status_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_used integer;
  v_quota integer;
  v_in_flight integer;
  v_concurrent_cap integer;
  v_used_bytes bigint;
  v_bytes_cap bigint;
  v_estimated_bytes bigint;
  v_doc_id uuid;
  v_job_id uuid;
  v_attempt_id uuid := coalesce(p_attempt_id, extensions.gen_random_uuid());
  v_trace_id text := coalesce(p_trace_id, extensions.gen_random_uuid()::text);
  v_payload jsonb;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_target_duration_seconds not in (30, 60, 90, 180) then
    raise exception 'invalid_target_duration_seconds' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  v_used := public.user_jobs_count_month(v_user_id);
  v_quota := coalesce(public.user_tier_quota(v_user_id), 3);

  if v_used >= v_quota then
    raise exception 'quota_exceeded' using errcode = '22023';
  end if;

  v_in_flight := public.user_concurrent_processing_count(v_user_id);
  v_concurrent_cap := coalesce(public.user_tier_concurrent_cap(v_user_id), 1);

  if v_in_flight >= v_concurrent_cap then
    raise exception 'concurrent_cap_exceeded' using errcode = '22023';
  end if;

  v_estimated_bytes := (p_target_duration_seconds * 25000)::bigint;
  v_used_bytes := public.user_storage_bytes(v_user_id);
  v_bytes_cap  := coalesce(
    public.user_tier_storage_bytes_cap(v_user_id), 524288000);

  if v_used_bytes + v_estimated_bytes > v_bytes_cap then
    raise exception 'storage_quota_exceeded' using errcode = '22023';
  end if;

  insert into public.song_documents (
    user_id, language, style_family, document_json)
  values (v_user_id, p_language, p_style_family, p_song_document)
  returning id into v_doc_id;

  insert into public.jobs (
    user_id, song_document_id, status, priority, progress,
    attempts, attempt_id, trace_id
  )
  values (
    v_user_id, v_doc_id, 'queued', p_priority, 0,
    0, v_attempt_id, v_trace_id
  )
  returning id into v_job_id;

  v_payload := jsonb_build_object(
    'job_id', v_job_id,
    'user_id', v_user_id,
    'song_document_id', v_doc_id,
    'priority', case when p_priority >= 1 then 'high' else 'normal' end,
    'created_at', to_char(now() at time zone 'utc',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'style_family', p_style_family,
    'target_duration_seconds', p_target_duration_seconds,
    'attempt_id', v_attempt_id,
    'attempt_number', 1,
    'trace_id', v_trace_id
  );

  perform public.enqueue_song_generation_job(v_payload);

  return query select v_job_id, v_doc_id,
                      'queued'::public.job_status_enum;
end;
$$;

-- 5. create_section_regen_job: same dual gate. Section regen counts
--    toward both the monthly quota (once completed) and the concurrent cap.
create or replace function public.create_section_regen_job(
  p_parent_job_id uuid,
  p_section_id text,
  p_attempt_id uuid default null,
  p_trace_id text default null
)
returns table(
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
  v_in_flight integer;
  v_concurrent_cap integer;
  v_doc jsonb;
  v_section_found boolean;
  v_new_job_id uuid;
  v_attempt_id uuid := coalesce(p_attempt_id, extensions.gen_random_uuid());
  v_trace_id text := coalesce(p_trace_id, extensions.gen_random_uuid()::text);
  v_payload jsonb;
  v_section_target integer;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select j.id, j.user_id, j.status, j.song_document_id,
         sd.document_json, sd.language, sd.style_family
    into v_parent
    from public.jobs j
    join public.song_documents sd on sd.id = j.song_document_id
   where j.id = p_parent_job_id;

  if v_parent.id is null or v_parent.user_id <> v_user_id then
    raise exception 'parent_job_not_found' using errcode = '42704';
  end if;
  if v_parent.status <> 'completed' then
    raise exception 'parent_job_not_completed' using errcode = '22023';
  end if;

  v_doc := v_parent.document_json;
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

  v_used := public.user_jobs_count_month(v_user_id);
  v_quota := coalesce(public.user_tier_quota(v_user_id), 3);
  if v_used >= v_quota then
    raise exception 'quota_exceeded' using errcode = '22023';
  end if;

  v_in_flight := public.user_concurrent_processing_count(v_user_id);
  v_concurrent_cap := coalesce(
    public.user_tier_concurrent_cap(v_user_id), 1);
  if v_in_flight >= v_concurrent_cap then
    raise exception 'concurrent_cap_exceeded' using errcode = '22023';
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
    'created_at', to_char(now() at time zone 'utc',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'style_family', v_parent.style_family,
    'target_duration_seconds', coalesce(v_section_target, 30),
    'attempt_id', v_attempt_id,
    'attempt_number', 1,
    'trace_id', v_trace_id,
    'is_section_regen', true
  );

  perform public.enqueue_song_generation_job(v_payload);

  return query
    select v_new_job_id, p_parent_job_id, p_section_id,
           'queued'::public.job_status_enum;
end;
$$;
