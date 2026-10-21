-- 0116_pool_track_grade.sql -- lyric grade of a pool track (strategy/premium-lyrics-tier.md sections 10.2 and 10.6).
--
-- Every existing row is 'standard'. Premium and Studio rows are written only by admin pool-ingest from Opus-written lyrics.
-- The station queue reads the column when present and applies the per-tier blend behind STATION_GRADES; without this
-- migration the read falls back to the old column list and every track counts as Standard, so the app can ship first.

set local search_path = public, extensions;

alter table public.pool_tracks
  add column if not exists lyric_grade text not null default 'standard'
    check (lyric_grade in ('standard', 'premium', 'studio'));

comment on column public.pool_tracks.lyric_grade is 'standard | premium | studio: which lyric pipeline wrote the track (lib/lyrics/grade.ts).';
