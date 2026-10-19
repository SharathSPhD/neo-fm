-- 0110_pool_track_reports.sql
-- DRAFT, NOT APPLIED. Lets listeners report a station pool track from the player (not only a public /s/ song page).
-- Needs S's go before prod apply. Degrades gracefully: until applied, POST /api/report with track_id answers 503
-- report_unavailable and the UI points to the complaints page; song-page reports are unaffected.
-- Service-role only for writes (the API inserts); existing RLS on song_reports stays as is.

set local search_path = public, extensions;

alter table public.song_reports
  add column if not exists pool_track_id uuid references public.pool_tracks(id) on delete cascade;

-- A pool report has no job (eval renders never had one), so job_id can no longer be mandatory.
alter table public.song_reports alter column job_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'song_reports_target_check') then
    alter table public.song_reports
      add constraint song_reports_target_check check (job_id is not null or pool_track_id is not null);
  end if;
end $$;

create index if not exists song_reports_pool_open_idx
  on public.song_reports (pool_track_id, created_at) where status = 'open' and pool_track_id is not null;
