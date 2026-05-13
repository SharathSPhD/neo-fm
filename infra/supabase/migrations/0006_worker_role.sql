-- 0006_worker_role.sql -- least-privilege neo_fm_worker DB role (ADR 0004)
--
-- The worker connects with PGUSER=neo_fm_worker. RLS does not apply to this
-- role (it is not anon/authenticated); the role gets exactly the grants the
-- worker needs and nothing else.
--
-- The role is created without LOGIN here. The operator (or a follow-up
-- migration during the smoke-test bringup) sets a password and adds LOGIN out
-- of band so credentials never live in git history.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'neo_fm_worker') then
    create role neo_fm_worker;
  end if;
end $$;

-- Schema usage
grant usage on schema public to neo_fm_worker;
grant usage on schema pgmq   to neo_fm_worker;

-- Worker reads Song Documents (referenced by queue messages)
grant select on public.song_documents to neo_fm_worker;

-- Worker reads jobs and writes only the lifecycle columns
grant select on public.jobs to neo_fm_worker;
grant update (
  status, started_at, finished_at, error, progress,
  attempts, attempt_id, trace_id, last_attempt_at, lease_renewed_at
) on public.jobs to neo_fm_worker;

-- Worker inserts (and reads, for idempotency dedup) tracks rows
grant select, insert on public.tracks to neo_fm_worker;

-- pgmq surface: full read/archive/delete of queue messages + execute functions
grant select, insert, update, delete on all tables in schema pgmq to neo_fm_worker;
grant execute on all functions       in schema pgmq to neo_fm_worker;

-- Explicit deny on sensitive surface. revoke is the belt; the absence of
-- grant is the suspenders, but we make it loud.
revoke all on public.users         from neo_fm_worker;
revoke all on public.subscriptions from neo_fm_worker;

comment on role neo_fm_worker is
  'ADR 0004: dedicated least-privilege role for services/dgx-worker. Has no SELECT on users or subscriptions, no DELETE on jobs, and writes only the lifecycle columns.';
