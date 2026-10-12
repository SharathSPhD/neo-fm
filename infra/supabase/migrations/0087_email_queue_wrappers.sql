-- 0087_email_queue_wrappers.sql -- let the notify-job-complete edge function reach the pgmq queue.
-- PostgREST exposes only the public schema, so the function cannot call pgmq.read / pgmq.archive directly.
-- Two security-definer wrappers, callable by the service role only.

create or replace function public.email_queue_read(p_qty integer default 5, p_vt integer default 30)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from pgmq.read('email_notifications', p_vt, p_qty) r;
$$;

create or replace function public.email_queue_archive(p_msg_id bigint)
returns boolean language sql security definer set search_path = '' as $$
  select pgmq.archive('email_notifications', p_msg_id);
$$;

revoke all on function public.email_queue_read(integer, integer) from public, anon, authenticated;
revoke all on function public.email_queue_archive(bigint) from public, anon, authenticated;
grant execute on function public.email_queue_read(integer, integer) to service_role;
grant execute on function public.email_queue_archive(bigint) to service_role;

-- Drain the queue every 2 minutes (replaces the job of the same name; safe to re-run).
create extension if not exists pg_cron;
select cron.schedule('notify-job-complete-drain', '*/2 * * * *', $$select net.http_post(url := 'https://kgxltxvjlsnbwomklwox.supabase.co/functions/v1/notify-job-complete', headers := '{"content-type":"application/json"}'::jsonb, body := '{}'::jsonb)$$);
