-- 0016_orphan_metrics.sql — Sprint C bug-b
--
-- The "Audio URL pending..." user-visible bug (v1.1 bug b) happens when
-- a job row ends up status='completed' without a matching `tracks` row,
-- or when a job is left in 'failed' and the user wants to retry. This
-- migration introduces four things:
--
--   1. `jobs.recovered_at` -- audit column populated by the recover RPC
--      and by the orphan-reconciler edge function. Lets us see how often
--      orphan recovery fires.
--
--   2. View `public.orphan_jobs` listing every job that is `completed`
--      but has zero `tracks` children. Used by:
--        - the reconciler edge function (Sprint C-b),
--        - operator queries, and
--        - the recover RPC's check.
--      The view is `security_invoker=on` so it honors caller RLS on
--      jobs/tracks (an authenticated user sees only their own orphans;
--      service_role sees all).
--
--   3. RPC `public.recover_song_job(p_job_id uuid)` -- the atomic
--      "retry me" entrypoint. SECURITY DEFINER + explicit search_path
--      (advisor-clean). Verifies ownership (auth.uid()), verifies the
--      job is recoverable (completed-orphan or failed), resets the
--      jobs row, re-enqueues pgmq. Returns the new attempt_id.
--
--      All-or-nothing inside one transaction. Direct UPDATE on
--      public.jobs is still revoked from `authenticated` (per migration
--      0005), so this RPC is the only path a user can reset their own
--      stuck job. Closes the same "PostgREST bypass" hole that
--      `create_song_job` closes for creation.
--
--   4. Index `tracks_job_id_created_at_idx` -- already used by the
--      app for the "latest track" sort. Idempotent.

alter table public.jobs
  add column if not exists recovered_at timestamptz;

create index if not exists jobs_orphan_idx
  on public.jobs (finished_at)
  where status = 'completed';

create index if not exists tracks_job_id_created_at_idx
  on public.tracks (job_id, created_at desc);

create or replace view public.orphan_jobs
  with (security_invoker = true)
  as
  select
    j.id              as job_id,
    j.user_id,
    j.song_document_id,
    j.status,
    j.attempts,
    j.attempt_id,
    j.finished_at,
    j.recovered_at,
    j.created_at,
    j.error
  from public.jobs j
  left join public.tracks t on t.job_id = j.id
  where j.status = 'completed'
    and t.id is null;

comment on view public.orphan_jobs is
  'Jobs that report status=completed yet have no rendered track row. Surfaced by the orphan-reconciler edge function and the /api/songs/[id]/recover endpoint. Indexed on jobs.finished_at via jobs_orphan_idx for cheap scans.';

grant select on public.orphan_jobs to authenticated;
grant select on public.orphan_jobs to service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'neo_fm_worker') then
    execute 'grant select on public.orphan_jobs to neo_fm_worker';
  end if;
end$$;

-- ---------------------------------------------------------------------
-- public.recover_song_job(p_job_id)
-- ---------------------------------------------------------------------

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
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;

  select j.user_id, j.song_document_id, j.status
    into v_user_id, v_song_document_id, v_status
    from public.jobs j
   where j.id = p_job_id
   for update;

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

  update public.jobs
     set status            = 'queued'::public.job_status_enum,
         attempt_id        = v_new_attempt_id,
         trace_id          = v_new_trace_id::text,
         error             = null,
         progress          = 0,
         started_at        = null,
         finished_at       = null,
         lease_renewed_at  = null,
         recovered_at      = now()
   where id = p_job_id;

  -- Re-enqueue. The worker reads pgmq and trusts the queue payload's
  -- user_id/song_document_id (claim_job_processing binds the claim to
  -- both columns, ADR 0008).
  perform pgmq.send(
    'q_song_jobs',
    jsonb_build_object(
      'job_id', p_job_id::text,
      'user_id', v_caller::text,
      'song_document_id', v_song_document_id::text,
      'attempt_id', v_new_attempt_id::text,
      'trace_id', v_new_trace_id::text,
      'reason', 'recover'
    )
  );

  return query
    select p_job_id, v_new_attempt_id, 'queued'::public.job_status_enum;
end;
$$;

comment on function public.recover_song_job(uuid) is
  'Atomically re-enqueues a stuck job (completed-without-tracks orphan, or failed). SECURITY DEFINER under explicit search_path. Only the job owner may invoke; ownership is checked against auth.uid() under FOR UPDATE.';

revoke execute on function public.recover_song_job(uuid) from public, anon;
grant execute on function public.recover_song_job(uuid) to authenticated;
grant execute on function public.recover_song_job(uuid) to service_role;
