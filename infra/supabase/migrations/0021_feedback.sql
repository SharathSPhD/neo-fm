-- 0021_feedback.sql -- user feedback inbox (Sprint E)
--
-- The /feedback page captures: subject, body, optional referrer (which
-- URL the user clicked from), and the authenticated user_id if any.
-- Anonymous feedback is allowed -- a lot of low-friction bug reports
-- come from people who never bothered to sign up.
--
-- Inserts go through public.submit_feedback(); reads are
-- service_role-only (we never expose feedback to other users).

create table if not exists public.feedback (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 5000),
  referrer text,
  status text not null default 'new' check (status in ('new','triaged','resolved','spam')),
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_at_idx
  on public.feedback (created_at desc);

comment on table public.feedback is
  'Free-form user-submitted feedback. Anonymous allowed. Service-role-only read.';

alter table public.feedback enable row level security;

create policy feedback_service_only_select on public.feedback
  for select to service_role using (true);

create or replace function public.submit_feedback(
  p_subject text,
  p_body text,
  p_referrer text default null
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_subject text := btrim(coalesce(p_subject, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_subject = '' then
    raise exception 'empty_subject' using errcode = '22023';
  end if;
  if char_length(v_subject) > 200 then
    v_subject := left(v_subject, 200);
  end if;
  if v_body = '' then
    raise exception 'empty_body' using errcode = '22023';
  end if;
  if char_length(v_body) > 5000 then
    v_body := left(v_body, 5000);
  end if;
  insert into public.feedback (user_id, subject, body, referrer)
  values (v_uid, v_subject, v_body, left(coalesce(p_referrer, ''), 500))
  returning public.feedback.id into v_id;
  return query select v_id;
end;
$$;

revoke execute on function public.submit_feedback(text, text, text) from public;
grant execute on function public.submit_feedback(text, text, text)
  to anon, authenticated, service_role;
