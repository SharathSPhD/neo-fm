-- 0069_abuse_report_queue.sql -- moderation queue + takedown for reported public songs
--
-- song_reports (0024) only recorded a free-text reason. This adds the review state the admin queue needs and a
-- takedown flag on jobs that survives an owner re-publishing: a taken-down song cannot be made public/unlisted
-- again until an operator reinstates it. All writes come from the service role (/api/admin/reports/resolve).

alter table public.song_reports
  add column if not exists category text,
  add column if not exists details text,
  add column if not exists status text not null default 'open',
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'song_reports_status_check') then
    alter table public.song_reports
      add constraint song_reports_status_check check (status in ('open', 'actioned', 'dismissed'));
  end if;
end $$;

-- Existing rows stored "category" or "category: details" in reason.
update public.song_reports
   set category = split_part(reason, ':', 1),
       details = nullif(btrim(substr(reason, position(':' in reason) + 1)), '')
 where category is null
   and split_part(reason, ':', 1) in ('impersonation', 'hateful_or_harassing', 'sexual_or_minor', 'copyright', 'other');

create index if not exists song_reports_open_idx on public.song_reports (created_at) where status = 'open';

alter table public.jobs
  add column if not exists moderation_status text not null default 'ok',
  add column if not exists taken_down_at timestamptz,
  add column if not exists takedown_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_moderation_status_check') then
    alter table public.jobs
      add constraint jobs_moderation_status_check check (moderation_status in ('ok', 'taken_down'));
  end if;
end $$;

-- Guard: only the service role (or a direct DB session) changes moderation fields, and a taken-down song stays private.
create or replace function public.jobs_moderation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.moderation_status is distinct from old.moderation_status
      or new.taken_down_at is distinct from old.taken_down_at
      or new.takedown_reason is distinct from old.takedown_reason)
     and coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception 'moderation_fields_are_operator_only' using errcode = '42501';
  end if;
  if new.moderation_status = 'taken_down' and new.published_visibility <> 'private' then
    raise exception 'song_taken_down' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists jobs_moderation_guard on public.jobs;
create trigger jobs_moderation_guard
  before update on public.jobs
  for each row execute function public.jobs_moderation_guard();

revoke all on function public.jobs_moderation_guard() from public, anon, authenticated;
