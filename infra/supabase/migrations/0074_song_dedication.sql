-- 0074_song_dedication.sql
-- "Dedicate this song": the owner adds a recipient name and a short message that appear on the public
-- song page and its share card. Stored on jobs so it rides the existing public-read RLS (published rows only);
-- a private song's dedication is never exposed. Text is moderated in the API route before this RPC is called.
-- jobs has no UPDATE policy for authenticated, so set_dedication (SECURITY DEFINER, owner-checked) is the only write
-- path; no view is created here.
alter table public.jobs
  add column if not exists dedication_to text,
  add column if not exists dedication_message text;

alter table public.jobs drop constraint if exists jobs_dedication_len;
alter table public.jobs add constraint jobs_dedication_len check (
  (dedication_to is null or char_length(dedication_to) between 1 and 60)
  and (dedication_message is null or char_length(dedication_message) between 1 and 280)
  and (dedication_message is null or dedication_to is not null)
);

-- Owner-only. Pass nulls to clear. Recipient is required whenever a message is set.
create or replace function public.set_dedication(
  p_job_id uuid,
  p_to text,
  p_message text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_to text := nullif(btrim(coalesce(p_to, '')), '');
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select user_id into v_owner from public.jobs where id = p_job_id;
  if v_owner is null then
    raise exception 'song not found' using errcode = 'P0002';
  end if;
  if v_owner <> v_uid then
    raise exception 'not the owner' using errcode = '42501';
  end if;
  if v_to is null then
    v_msg := null; -- clearing (or no recipient): drop both
  end if;
  update public.jobs set dedication_to = v_to, dedication_message = v_msg where id = p_job_id;
end;
$$;

revoke execute on function public.set_dedication(uuid, text, text) from public, anon;
grant execute on function public.set_dedication(uuid, text, text) to authenticated;
