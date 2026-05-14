-- 0007_queue_helpers.sql -- service_role-only enqueue wrapper
--
-- PostgREST only exposes the `public` schema. pgmq lives in its own schema,
-- so the cloud API (supabase-js with the service_role key) cannot call
-- `pgmq.send` directly through `rpc()`. We expose a thin public wrapper that
-- is locked down to service_role and validates the payload shape.

create or replace function public.enqueue_song_generation_job(payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg_id bigint;
begin
  if not (
    payload ? 'job_id'
    and payload ? 'user_id'
    and payload ? 'song_document_id'
    and payload ? 'attempt_id'
    and payload ? 'trace_id'
    and payload ? 'style_family'
    and payload ? 'target_duration_seconds'
  ) then
    raise exception 'enqueue payload missing required keys' using errcode = '22023';
  end if;

  select pgmq.send('song_generation_jobs', payload) into msg_id;
  return msg_id;
end;
$$;

revoke execute on function public.enqueue_song_generation_job(jsonb)
  from public, anon, authenticated;
grant execute on function public.enqueue_song_generation_job(jsonb)
  to service_role;

comment on function public.enqueue_song_generation_job(jsonb) is
  'Cloud-API-only enqueue wrapper around pgmq.send. SECURITY DEFINER so service_role can write through PostgREST without granting pgmq schema access elsewhere.';
