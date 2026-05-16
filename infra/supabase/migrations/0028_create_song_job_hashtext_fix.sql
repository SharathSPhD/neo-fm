-- 0028_create_song_job_hashtext_fix.sql -- unblock song creation (v1.2 bug 1)
--
-- Bug report (production, May 2026):
--   POST /api/songs failed with:
--     "function extensions.hashtextextended(text, integer) does not exist"
--
-- Migration 0017 redefined create_song_job with `set search_path = ''` and
-- prefixed the advisory-lock hash with `extensions.`. `hashtextextended` is
-- a pg_catalog builtin, not part of pgcrypto, so the qualified call fails.
-- Earlier definitions (0008, 0009, 0012, 0015) correctly used the unqualified
-- form; pg_catalog is always implicitly on the search_path. We re-qualify with
-- pg_catalog to keep the explicit search_path discipline while resolving to
-- the correct function.
--
-- The function body below is byte-for-byte identical to migration 0017 with
-- two changes:
--   1. line `pg_advisory_xact_lock` -> qualified `pg_catalog.hashtextextended`
--   2. comment block above the function describing this hotfix
--
-- `create or replace function` keeps existing grants and RLS intact.

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
  v_title text;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_target_duration_seconds not in (30, 60, 90, 180) then
    raise exception 'invalid_target_duration_seconds' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0));

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

  v_title := nullif(btrim(coalesce(p_song_document->>'title', '')), '');
  if v_title is not null and char_length(v_title) > 120 then
    v_title := left(v_title, 120);
  end if;
  if v_title is null then
    v_title := initcap(replace(p_style_family::text, '-', ' ')) || ' in '
             || case p_language::text
                  when 'en' then 'English'
                  when 'hi' then 'Hindi'
                  when 'kn' then 'Kannada'
                  else p_language::text
                end
             || ' -- ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  end if;

  insert into public.song_documents (
    user_id, language, style_family, document_json, title)
  values (v_user_id, p_language, p_style_family, p_song_document, v_title)
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

comment on function public.create_song_job(
  jsonb, public.language_enum, public.style_family_enum,
  integer, integer, uuid, text
) is
  'Create a song generation job. Per-user advisory lock + monthly quota + concurrent cap + storage check. Hotfixed in v1.2 (migration 0028) to call pg_catalog.hashtextextended explicitly under set search_path = '''' .';
