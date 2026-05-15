-- 0011_realtime_publication.sql -- publish jobs + tracks for Phase 5 realtime
--
-- Phase 5's library page subscribes to postgres_changes on `public.jobs`
-- via Supabase Realtime. That subscription is silently a no-op unless the
-- table is a member of the `supabase_realtime` publication. The earlier
-- migrations (0001-0010) never altered the publication, so the UI showed
-- "Queued" forever even after the worker wrote `status = 'completed'`.
--
-- This migration:
--   * adds public.jobs + public.tracks to `supabase_realtime` so the
--     library page's UPDATE/INSERT subscription works,
--   * sets REPLICA IDENTITY DEFAULT (PK only) - the UI only consumes the
--     new-record payload so we don't pay the WAL cost of FULL.
--
-- song_documents is intentionally NOT added: they are immutable after
-- insert and the UI doesn't subscribe to them.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'jobs'
  ) then
    alter publication supabase_realtime add table public.jobs;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tracks'
  ) then
    alter publication supabase_realtime add table public.tracks;
  end if;
end $$;

-- REPLICA IDENTITY DEFAULT is the cheapest choice and gives the UI
-- everything it needs (new-record payload). If a future surface needs the
-- pre-update column values, bump these to FULL.
alter table public.jobs   replica identity default;
alter table public.tracks replica identity default;
