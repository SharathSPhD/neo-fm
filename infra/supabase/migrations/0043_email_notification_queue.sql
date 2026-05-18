-- 0043_email_notification_queue.sql -- queue-backed job-complete emails
--
-- Background:
--   Migration 0029 wired a sync pg_net webhook from public.jobs UPDATE
--   straight into the notify-job-complete Edge Function. That works but
--   has two operational drawbacks:
--     1. A transient Edge Function / Resend outage drops the email
--        silently -- pg_net is fire-and-forget and there is no retry.
--     2. A spike in completed jobs creates a spike in concurrent Edge
--        Function invocations, all racing the same Resend rate limit.
--
--   This migration adds a durable pgmq queue (`email_notifications`)
--   between the trigger and the Edge Function. The Edge Function is now
--   a *drain*: it reads up to N messages on each invocation (cron every
--   2 minutes -- see functions/notify-job-complete/schedule.json) and
--   archives only on successful Resend response. A failure leaves the
--   message visible after its visibility timeout for the next pass.
--
--   The pg_net webhook trigger from 0029 is left untouched for now; the
--   queue-backed path runs alongside it as the durable channel. When
--   the queue path is proven in prod we can drop the 0029 trigger.
--
-- Surface added by this migration:
--   1. pgmq queue `email_notifications` (idempotent: pgmq.create no-ops
--      when the queue already exists, but we still wrap it in DO so a
--      missing pgmq extension doesn't blow up CI).
--   2. public.enqueue_job_complete_email(p_job_id uuid, p_status text)
--      SECURITY DEFINER function. Looks up the user's email + the song
--      title + the job's public_id, then pgmq.send onto the queue.
--   3. Trigger public.jobs_email_notify on public.jobs AFTER UPDATE
--      that calls enqueue_job_complete_email when the row transitions
--      INTO ('completed','failed') from any other status. Self-guarded
--      so re-applying the migration is safe.
--
-- Idempotent across re-application.

-- ---------------------------------------------------------------------
-- 1. Queue creation. pgmq.create is itself idempotent (creates a
--    pgmq.q_<name> + pgmq.a_<name> only if missing), but we guard the
--    SELECT in a DO block so a fresh dev project missing pgmq fails
--    loudly rather than silently.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_extension where extname = 'pgmq'
  ) then
    raise exception
      'pgmq extension is not installed -- expected from 0001_init.sql';
  end if;

  -- pgmq.create raises notice "queue already exists" but does not
  -- error; we still wrap it in a NOT EXISTS check so the migration log
  -- stays clean.
  if not exists (
    select 1 from pgmq.list_queues()
    where queue_name = 'email_notifications'
  ) then
    perform pgmq.create('email_notifications');
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. enqueue_job_complete_email -- the only writer to the queue.
--
--    SECURITY DEFINER so the trigger (running as the row owner) can
--    reach into auth.users and pgmq without granting those schemas to
--    every user. search_path = '' for the usual safety reasons (ADR
--    0021): all object references are fully qualified.
--
--    The function tolerates missing rows gracefully -- if either the
--    auth user or the song_documents row has been deleted between the
--    job UPDATE and this lookup, we still enqueue with NULL values so
--    the Edge Function can decide whether to skip or send a degraded
--    email. The Edge Function's contract is "no email if user_email is
--    null".
-- ---------------------------------------------------------------------
create or replace function public.enqueue_job_complete_email(
  p_job_id uuid,
  p_status text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_email text;
  v_song_title text;
  v_public_id text;
  v_msg_id bigint;
  v_payload jsonb;
begin
  if p_status not in ('completed', 'failed') then
    raise exception
      'enqueue_job_complete_email: p_status must be completed or failed, got %',
      p_status
      using errcode = '22023';
  end if;

  -- Join jobs -> song_documents in one shot so we do not pay for two
  -- index probes. The LEFT JOIN keeps us alive if song_documents was
  -- already cascade-deleted.
  select j.user_id, s.title, j.public_id
    into v_user_id, v_song_title, v_public_id
  from public.jobs j
  left join public.song_documents s on s.id = j.song_document_id
  where j.id = p_job_id;

  if v_user_id is null then
    -- Job row vanished between the trigger fire and now. Log and skip
    -- rather than raising -- the trigger does not want to abort the
    -- original UPDATE because of a notification problem.
    raise warning
      'enqueue_job_complete_email: job % not found, skipping enqueue',
      p_job_id;
    return null;
  end if;

  select email into v_user_email
    from auth.users
   where id = v_user_id;

  v_payload := jsonb_build_object(
    'job_id', p_job_id,
    'user_email', v_user_email,
    'song_title', v_song_title,
    'status', p_status,
    'public_id', v_public_id
  );

  select pgmq.send('email_notifications', v_payload) into v_msg_id;
  return v_msg_id;
end;
$$;

revoke all on function public.enqueue_job_complete_email(uuid, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_job_complete_email(uuid, text)
  to service_role;

alter function public.enqueue_job_complete_email(uuid, text)
  owner to postgres;

comment on function public.enqueue_job_complete_email(uuid, text) is
  'Migration 0043. SECURITY DEFINER. Joins jobs -> song_documents + auth.users to assemble an email notification payload, then pgmq.send onto the email_notifications queue. Returns the pgmq msg_id. Called by the jobs_email_notify trigger.';

-- ---------------------------------------------------------------------
-- 3. Trigger function -- a thin wrapper around enqueue_job_complete_email
--    that the AFTER UPDATE trigger can call. Kept separate so future
--    callers (e.g. an admin re-send RPC) can hit the enqueue helper
--    without going through the trigger.
--
--    SECURITY DEFINER so the trigger runs with rights to reach
--    auth.users via enqueue_job_complete_email's body.
-- ---------------------------------------------------------------------
create or replace function public.tg_enqueue_job_complete_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The WHEN clause on the trigger does the gating; we double-check
  -- here in case the function is invoked outside of the trigger
  -- (e.g. by an operator running UPDATE ... triggered explicitly).
  if new.status in ('completed', 'failed')
     and (old.status is null or old.status not in ('completed', 'failed'))
  then
    perform public.enqueue_job_complete_email(new.id, new.status);
  end if;
  return null;
end;
$$;

revoke all on function public.tg_enqueue_job_complete_email()
  from public, anon, authenticated;

alter function public.tg_enqueue_job_complete_email() owner to postgres;

comment on function public.tg_enqueue_job_complete_email() is
  'Migration 0043. AFTER UPDATE trigger function on public.jobs. Calls public.enqueue_job_complete_email when status transitions into completed/failed from any other state.';

-- ---------------------------------------------------------------------
-- 4. The trigger. Guarded so re-applying the migration is safe.
--    Distinct name from notify_job_complete (migration 0029) so the
--    two paths run in parallel during rollout.
-- ---------------------------------------------------------------------
drop trigger if exists jobs_email_notify on public.jobs;
create trigger jobs_email_notify
  after update of status on public.jobs
  for each row
  when (
    new.status in ('completed', 'failed')
    and (old.status is null or old.status not in ('completed', 'failed'))
  )
  execute function public.tg_enqueue_job_complete_email();

comment on trigger jobs_email_notify on public.jobs is
  'Migration 0043. Enqueues an email_notifications pgmq message when a job transitions into completed/failed. Runs alongside the 0029 pg_net webhook until queue-based path is proven.';
