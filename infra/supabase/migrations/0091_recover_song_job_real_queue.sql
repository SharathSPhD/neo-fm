-- 0091_recover_song_job_real_queue.sql -- recover_song_job enqueues on the queue the worker actually reads.
--
-- 0016 sent the retry to pgmq queue 'q_song_jobs'. No migration creates that queue (0004 creates
-- 'song_generation_jobs'), and neo-fm-prod has no such queue, so recovering a failed or orphaned song raised
-- "relation pgmq.q_q_song_jobs does not exist" and rolled back. The body below is 0090's recover_song_job
-- (refunded pack jobs re-spend a credit) with the enqueue changed to public.enqueue_song_generation_job, using
-- create_song_job's payload; style_family and target_duration_seconds are read from the song document. Checks and
-- grants are unchanged.

create or replace function public.recover_song_job(p_job_id uuid)
returns table (job_id uuid, attempt_id uuid, status public.job_status_enum)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller            uuid := auth.uid();
  v_user_id           uuid;
  v_song_document_id  uuid;
  v_status            public.job_status_enum;
  v_track_count       int;
  v_new_attempt_id    uuid := gen_random_uuid();
  v_new_trace_id      uuid := gen_random_uuid();
  v_pack_id           uuid;
  v_pack_refunded     timestamptz;
  v_new_pack_id       uuid;
  v_style_family      public.style_family_enum;
  v_duration          integer;
  v_priority          integer;
  v_attempts          integer;
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;

  select j.user_id, j.song_document_id, j.status, j.pack_id, j.pack_refunded_at,
         sd.style_family, (sd.document_json->>'target_duration_seconds')::integer, j.priority, j.attempts
    into v_user_id, v_song_document_id, v_status, v_pack_id, v_pack_refunded,
         v_style_family, v_duration, v_priority, v_attempts
    from public.jobs j
    join public.song_documents sd on sd.id = j.song_document_id
   where j.id = p_job_id
   for update of j;

  if v_user_id is null then
    -- Don't leak existence to non-owners; behave as "not found".
    raise exception 'job_not_found';
  end if;
  if v_user_id <> v_caller then
    raise exception 'job_not_found';
  end if;

  select count(*) into v_track_count
    from public.tracks
   where tracks.job_id = p_job_id;

  -- Recoverable only when:
  --   (a) status='completed' AND no tracks row (the "Audio URL pending"
  --       orphan -- bug b), or
  --   (b) status='failed' (the user wants to retry an explicit failure).
  -- Never recover queued/processing (would race the worker).
  if not (
    (v_status = 'completed'::public.job_status_enum and v_track_count = 0)
    or v_status = 'failed'::public.job_status_enum
  ) then
    raise exception 'not_recoverable: status=%, tracks=%', v_status, v_track_count;
  end if;

  -- A pack job whose credit was refunded on failure must pay again to be retried, otherwise the refund plus a free
  -- retry would give two songs for one credit. Any pack with credit will do (not necessarily the original one). With
  -- none left the job stays failed. The advisory lock is the same per-user key create_song_job takes, so the spend is
  -- serialised against new jobs.
  if v_pack_id is not null and v_pack_refunded is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
    select id into v_new_pack_id
      from public.song_packs
     where user_id = v_user_id and songs_used < songs_total
     order by created_at
     limit 1
     for update;
    if v_new_pack_id is null then
      raise exception 'quota_exceeded' using errcode = '22023';
    end if;
    update public.song_packs set songs_used = songs_used + 1 where id = v_new_pack_id;
  end if;

  update public.jobs
     set status            = 'queued'::public.job_status_enum,
         pack_id           = coalesce(v_new_pack_id, pack_id),
         pack_refunded_at  = case when v_new_pack_id is not null then null else pack_refunded_at end,
         attempt_id        = v_new_attempt_id,
         trace_id          = v_new_trace_id::text,
         error             = null,
         progress          = 0,
         started_at        = null,
         finished_at       = null,
         lease_renewed_at  = null,
         recovered_at      = now()
   where id = p_job_id;

  -- Re-enqueue on the real queue with the payload shape create_song_job sends (the wrapper validates the keys).
  -- 0016 sent to 'q_song_jobs', a queue no migration creates, so every recover failed in production.
  perform public.enqueue_song_generation_job(jsonb_build_object(
    'job_id', p_job_id,
    'user_id', v_caller,
    'song_document_id', v_song_document_id,
    'priority', case when coalesce(v_priority, 0) >= 1 then 'high' else 'normal' end,
    'created_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'style_family', v_style_family,
    'target_duration_seconds', v_duration,
    'attempt_id', v_new_attempt_id,
    'attempt_number', coalesce(v_attempts, 0) + 1,
    'trace_id', v_new_trace_id::text
  ));

  return query
    select p_job_id, v_new_attempt_id, 'queued'::public.job_status_enum;
end;
$$;

comment on function public.recover_song_job(uuid) is
  'Atomically re-enqueues a stuck job (completed-without-tracks orphan, or failed) on song_generation_jobs. SECURITY DEFINER under explicit search_path. Only the job owner may invoke; ownership is checked against auth.uid() under FOR UPDATE. A pack job whose credit was refunded re-spends a credit first (0090), raising quota_exceeded when none is left.';

revoke execute on function public.recover_song_job(uuid) from public, anon;
grant execute on function public.recover_song_job(uuid) to authenticated, service_role;
