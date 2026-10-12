-- neo-fm-prod bootstrap, part 2b (0046-0050). Run after part2a: the new enum value 'developer' (0045) must be committed before 0046 uses it.

-- ======== 0046_developer_tier_functions.sql ========
-- 0046_developer_tier_functions.sql
--
-- Depends on 0045_developer_tier_enum.sql (enum value must be committed first).
--
-- Updates the two tier-quota functions to handle the new `developer` enum value,
-- then promotes the operator account to developer tier.
--
-- developer quota:  999 999 songs/month (effectively unlimited)
-- developer storage: 1 TB (effectively unlimited)

CREATE OR REPLACE FUNCTION public.user_tier_quota(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE COALESCE(u.tier, 'free'::public.tier_enum)
    WHEN 'free'      THEN 3
    WHEN 'creator'   THEN 100
    WHEN 'pro'       THEN 1000
    WHEN 'developer' THEN 999999
  END
  FROM public.users u WHERE u.id = p_user_id;
$$;

COMMENT ON FUNCTION public.user_tier_quota(uuid) IS
  'ADR 0009 / 0045: songs-per-month cap by tier. developer=999999 (effectively unlimited).';

CREATE OR REPLACE FUNCTION public.user_tier_storage_bytes_cap(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE COALESCE(u.tier, 'free'::public.tier_enum)
    WHEN 'free'      THEN 524288000::bigint       -- 500 MB
    WHEN 'creator'   THEN 5368709120::bigint       -- 5 GB
    WHEN 'pro'       THEN 53687091200::bigint      -- 50 GB
    WHEN 'developer' THEN 1099511627776::bigint    -- 1 TB
  END
  FROM public.users u WHERE u.id = p_user_id;
$$;

COMMENT ON FUNCTION public.user_tier_storage_bytes_cap(uuid) IS
  'ADR 0005 / ADR 0045: per-tier storage byte cap. developer=1 TB.';

-- Promote the operator/developer account.
-- This UPDATE is idempotent (re-running sets developer→developer).
UPDATE public.users
SET tier = 'developer'
WHERE email = 'sharath.ai.colab@gmail.com';

-- ======== 0047_voice_samples_allow_json.sql ========
-- v1.5: Allow manifest.json uploads to the voice-samples bucket.
--
-- The render_voice_previews.py script uploads a manifest.json alongside
-- the WAV files so the web picker can distinguish real Parler-TTS previews
-- from FakeVocalModel placeholders without relying on Content-Length alone
-- (both produce 960 044-byte files for 10s × 48kHz mono audio).

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/json')
where id = 'voice-samples'
  and not ('application/json' = any(allowed_mime_types));

-- ======== 0048_fix_email_trigger_enum_cast.sql ========
-- 0048_fix_email_trigger_enum_cast.sql
--
-- The trigger body passes new.status (type: public.job_status_enum) to
-- enqueue_job_complete_email(uuid, text). PostgreSQL won't implicitly
-- cast a user-defined enum to text in function overload resolution, so
-- the worker crashes with "function does not exist" every time it calls
-- mark_failed() or mark_completed().
--
-- Fix: explicitly cast new.status::text in the trigger body.

CREATE OR REPLACE FUNCTION public.tg_enqueue_job_complete_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  if new.status in ('completed', 'failed')
     and (old.status is null or old.status not in ('completed', 'failed'))
  then
    perform public.enqueue_job_complete_email(new.id, new.status::text);
  end if;
  return null;
end;
$function$;

-- ======== 0049_seed_songs_add_target_seconds.sql ========
-- 0049_seed_songs_add_target_seconds.sql
--
-- Seed song documents were created without target_seconds in each section.
-- The Python SongDocument Pydantic model requires it (sum must equal
-- target_duration_seconds). The DGX worker validation fails on every seed
-- job, preventing the discover feed from populating.
--
-- Fix: for any section in a public discover-seed song_document that is
-- missing target_seconds, distribute target_duration_seconds evenly across
-- all sections in that document.
--
-- Idempotent: the EXISTS subquery only matches documents that still have
-- at least one section without target_seconds.

UPDATE public.song_documents sd
SET document_json = (
  SELECT jsonb_set(
    sd.document_json,
    '{sections}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN s ? 'target_seconds' THEN s
          ELSE s || jsonb_build_object(
            'target_seconds',
            (sd.document_json->>'target_duration_seconds')::int
              / jsonb_array_length(sd.document_json->'sections')
          )
        END
      )
      FROM jsonb_array_elements(sd.document_json->'sections') AS s
    )
  )
)
FROM public.jobs j
WHERE j.song_document_id = sd.id
  AND j.published_visibility = 'public'
  AND j.status IN ('processing', 'queued')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(sd.document_json->'sections') AS sec
    WHERE NOT (sec ? 'target_seconds')
  );

-- ======== 0050_cover_art_queue_grants.sql ========
-- 0050_cover_art_queue_grants.sql
--
-- Migration 0006 grants "all tables in schema pgmq to neo_fm_worker" at
-- execution time — a snapshot grant. pgmq.create() in 0034 added new
-- tables (pgmq.q_cover_art_jobs, pgmq.a_cover_art_jobs, and their DLQ
-- counterparts) after 0006 ran, so neo_fm_worker has no rights on them.
--
-- Effect: the dgx-worker cover_art_consumer_loop raises
-- "permission denied for table q_cover_art_jobs" on every poll (every 2 s),
-- flooding logs and wasting DB connections.
--
-- Fix: explicit grants on the four tables and their msg_id sequences.
-- Also add ALTER DEFAULT PRIVILEGES so any future pgmq.create() call
-- from the postgres role grants to neo_fm_worker automatically.

grant select, insert, update, delete
  on pgmq.q_cover_art_jobs         to neo_fm_worker;

grant select, insert, update, delete
  on pgmq.a_cover_art_jobs         to neo_fm_worker;

grant select, insert, update, delete
  on pgmq.q_cover_art_jobs_dlq     to neo_fm_worker;

grant select, insert, update, delete
  on pgmq.a_cover_art_jobs_dlq     to neo_fm_worker;

grant usage
  on sequence pgmq.q_cover_art_jobs_msg_id_seq     to neo_fm_worker;

grant usage
  on sequence pgmq.q_cover_art_jobs_dlq_msg_id_seq to neo_fm_worker;

-- neo_fm_worker also needs DML on public.cover_art to execute the
-- flip_current_cover_art transaction (set old is_current=false, insert new).
-- The original migration 0026 only granted to anon/authenticated/service_role.
grant select, insert, update on public.cover_art to neo_fm_worker;
