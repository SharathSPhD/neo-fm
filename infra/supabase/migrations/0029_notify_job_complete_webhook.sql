-- 0029_notify_job_complete_webhook.sql -- wire job-complete notification
--
-- Creates a Postgres trigger on public.jobs that POSTs to the
-- `notify-job-complete` Edge Function when a row transitions to
-- status = 'completed'. The function then looks up the user's email +
-- song title and sends a Resend transactional email.
--
-- Why a trigger instead of Supabase Dashboard "Database Webhooks"?
--   - Reproducibility. Webhook config in the dashboard is invisible to git;
--     a migration is auditable and revertible.
--   - The trigger reads the shared secret from supabase_vault.decrypted_secrets
--     so the secret never lives in source code or migration history.
--
-- Pre-requisites (set by this migration):
--   - pg_net extension (Async HTTP for triggers).
--   - vault secret named 'neo_fm_webhook_secret' (populated out-of-band via
--     execute_sql; never committed to git).
--
-- Idempotent: trigger and helper function are created via `or replace`.

create extension if not exists pg_net with schema extensions;

-- ----------------------------------------------------------------------------
-- 1. Helper: fetch the shared webhook secret from supabase_vault.
--
-- security definer + search_path = '' so the function can read the vault
-- on behalf of the trigger's authenticated role. The secret name is
-- inserted out-of-band; if it is missing the trigger short-circuits to a
-- no-op (the email simply doesn't fire) so a fresh dev project doesn't
-- break inserts.
-- ----------------------------------------------------------------------------
create or replace function public.neo_fm_webhook_secret()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select decrypted_secret from vault.decrypted_secrets
   where name = 'neo_fm_webhook_secret' limit 1;
$$;

revoke all on function public.neo_fm_webhook_secret() from public;
revoke all on function public.neo_fm_webhook_secret() from anon, authenticated;
grant execute on function public.neo_fm_webhook_secret() to service_role;

comment on function public.neo_fm_webhook_secret() is
  'Returns the shared secret used to authenticate trigger calls to the notify-job-complete Edge Function. Service role only. Body reads supabase_vault.decrypted_secrets.';

-- ----------------------------------------------------------------------------
-- 2. Trigger function: POST to the Edge Function when status flips to
--    completed. Uses pg_net so the HTTP call is async and the transaction
--    is not blocked on the response.
-- ----------------------------------------------------------------------------
create or replace function public.tg_notify_job_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := public.neo_fm_webhook_secret();
  v_url text := 'https://lsxicfgqtdxvlcivlwmd.functions.supabase.co/notify-job-complete';
  v_payload jsonb;
begin
  -- No-op if the secret isn't populated yet (fresh project / pre-handover).
  if v_secret is null or v_secret = '' then
    return null;
  end if;

  v_payload := jsonb_build_object(
    'type', 'UPDATE',
    'table', 'jobs',
    'schema', 'public',
    'record', jsonb_build_object(
      'id', new.id,
      'user_id', new.user_id,
      'status', new.status,
      'finished_at', new.finished_at
    ),
    'old_record', jsonb_build_object(
      'status', old.status
    )
  );

  -- pg_net creates its own `net` schema regardless of WITH SCHEMA target;
  -- net.http_post is async and returns a bigint request id immediately.
  perform net.http_post(
    url := v_url,
    body := v_payload,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );
  return null;
end;
$$;

revoke all on function public.tg_notify_job_complete() from public;

comment on function public.tg_notify_job_complete() is
  'AFTER UPDATE trigger on public.jobs. Fires only when status transitions to completed. Async POST via pg_net to /notify-job-complete with x-webhook-secret header. Migration 0029.';

-- ----------------------------------------------------------------------------
-- 3. The trigger itself. Guarded on status transition so we never re-fire
--    on idempotent updates.
-- ----------------------------------------------------------------------------
drop trigger if exists notify_job_complete on public.jobs;
create trigger notify_job_complete
  after update of status on public.jobs
  for each row
  when (new.status = 'completed' and old.status is distinct from new.status)
  execute function public.tg_notify_job_complete();

comment on trigger notify_job_complete on public.jobs is
  'Fires public.tg_notify_job_complete() when a job transitions to completed. Migration 0029.';
