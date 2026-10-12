-- 0065_song_ready_email_repoint.sql -- point the song-ready email at neo-fm-prod
--
-- Two fixes on top of 0029 / 0043:
--   1. 0029 hardcoded the retired Supabase project's functions URL, so the
--      pg_net nudge that wakes the notify-job-complete drain never reached
--      neo-fm-prod. The URL now comes from vault ('neo_fm_notify_url') and
--      falls back to the prod project. The nudge only speeds delivery up:
--      the durable path is the 0043 pgmq queue, drained by the function.
--   2. The queue payload now carries the song language so the email can be
--      written in the listener's language.
--
-- Still a clean no-op without the out-of-band vault secret
-- 'neo_fm_webhook_secret' (0029 contract), and the Edge Function leaves
-- messages queued while RESEND_API_KEY is unset.
-- Idempotent.

create or replace function public.neo_fm_notify_url()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets
      where name = 'neo_fm_notify_url' limit 1),
    'https://kgxltxvjlsnbwomklwox.functions.supabase.co/notify-job-complete'
  );
$$;

revoke all on function public.neo_fm_notify_url() from public, anon, authenticated;
grant execute on function public.neo_fm_notify_url() to service_role;

create or replace function public.tg_notify_job_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := public.neo_fm_webhook_secret();
  v_url text := public.neo_fm_notify_url();
  v_payload jsonb;
begin
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
    'old_record', jsonb_build_object('status', old.status)
  );

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
exception when others then
  -- A notification problem must never roll back the job completing.
  raise warning 'tg_notify_job_complete: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

revoke all on function public.tg_notify_job_complete() from public, anon, authenticated;

-- Queue payload gains `language` (song_documents.language, e.g. 'hi', 'ta').
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
  v_language text;
  v_msg_id bigint;
begin
  if p_status not in ('completed', 'failed') then
    raise exception
      'enqueue_job_complete_email: p_status must be completed or failed, got %',
      p_status
      using errcode = '22023';
  end if;

  select j.user_id, s.title, j.public_id, s.language::text
    into v_user_id, v_song_title, v_public_id, v_language
  from public.jobs j
  left join public.song_documents s on s.id = j.song_document_id
  where j.id = p_job_id;

  if v_user_id is null then
    raise warning
      'enqueue_job_complete_email: job % not found, skipping enqueue',
      p_job_id;
    return null;
  end if;

  select email into v_user_email from auth.users where id = v_user_id;

  select pgmq.send('email_notifications', jsonb_build_object(
    'job_id', p_job_id,
    'user_email', v_user_email,
    'song_title', v_song_title,
    'status', p_status,
    'public_id', v_public_id,
    'language', v_language
  )) into v_msg_id;
  return v_msg_id;
end;
$$;

revoke all on function public.enqueue_job_complete_email(uuid, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_job_complete_email(uuid, text)
  to service_role;
alter function public.enqueue_job_complete_email(uuid, text) owner to postgres;
