-- 0008_create_song_job.sql -- atomic, quota-enforcing job creation
--
-- Phase 4 adversarial review found two related issues with the previous
-- POST /api/songs flow:
--
--   1. **Quota bypass.** RLS allowed `authenticated` to INSERT into
--      `public.jobs` and `public.song_documents` directly. A user with a
--      valid session could call PostgREST or use supabase-js to skip the
--      API's daily-quota check entirely.
--
--   2. **Quota TOCTOU.** Two parallel POST /api/songs requests for the
--      same user could both observe `used < quota` and then both insert,
--      exceeding the cap.
--
-- This migration closes both by:
--   - Removing the INSERT path on those tables for `authenticated`.
--   - Introducing a single SECURITY DEFINER RPC that takes a per-user
--     transaction-scoped advisory lock, re-checks quota under the lock,
--     inserts the rows, and enqueues the queue message in one atomic
--     transaction.

create or replace function public.create_song_job(
  p_song_document jsonb,
  p_language public.language_enum,
  p_style_family public.style_family_enum,
  p_target_duration_seconds integer,
  p_priority integer default 0,
  p_attempt_id uuid default null,
  p_trace_id text default null
) returns table (
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
  v_doc_id uuid;
  v_job_id uuid;
  v_attempt_id uuid := coalesce(p_attempt_id, gen_random_uuid());
  v_trace_id text := coalesce(p_trace_id, gen_random_uuid()::text);
  v_payload jsonb;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_target_duration_seconds not in (30, 60, 90, 180) then
    raise exception 'invalid_target_duration_seconds' using errcode = '22023';
  end if;

  -- Per-user transaction-scoped advisory lock. Two concurrent calls for the
  -- same user serialize here; concurrent calls for *different* users do not
  -- block each other.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  v_used := public.user_jobs_count_today(v_user_id);
  v_quota := coalesce(public.user_tier_quota(v_user_id), 5);

  if v_used >= v_quota then
    raise exception 'quota_exceeded' using errcode = '22023';
  end if;

  insert into public.song_documents (user_id, language, style_family, document_json)
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
    'created_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'style_family', p_style_family,
    'target_duration_seconds', p_target_duration_seconds,
    'attempt_id', v_attempt_id,
    'attempt_number', 1,
    'trace_id', v_trace_id
  );

  perform public.enqueue_song_generation_job(v_payload);

  return query select v_job_id, v_doc_id, 'queued'::public.job_status_enum;
end;
$$;

revoke execute on function public.create_song_job(
  jsonb, public.language_enum, public.style_family_enum, integer, integer, uuid, text
) from public, anon;
grant execute on function public.create_song_job(
  jsonb, public.language_enum, public.style_family_enum, integer, integer, uuid, text
) to authenticated;

comment on function public.create_song_job(
  jsonb, public.language_enum, public.style_family_enum, integer, integer, uuid, text
) is
  'Atomic song-job creation for authenticated users: per-user advisory lock + quota check + song_document insert + jobs insert + pgmq enqueue. The only sanctioned path; direct INSERT on public.jobs / public.song_documents is revoked from authenticated.';

-- Lock down the direct insert path so the RPC is the only way through.
drop policy if exists song_documents_insert_own on public.song_documents;
drop policy if exists jobs_insert_own on public.jobs;

revoke insert on public.song_documents from authenticated;
revoke insert on public.jobs from authenticated;
