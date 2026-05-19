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
