-- P4: daypart and energy tags for the station pool. Both are filled by the tagger, not by the listener.
-- daypart is a set (a track can suit more than one part of the day); energy is one of three bands.
alter table public.pool_tracks
  add column if not exists energy text
    check (energy in ('low', 'mid', 'high')),
  add column if not exists daypart text[] not null default '{}'
    check (daypart <@ array['dawn', 'morning', 'midday', 'evening', 'dusk', 'night']::text[]);

create index if not exists pool_tracks_daypart_idx
  on public.pool_tracks using gin (daypart) where status = 'admitted';

comment on column public.pool_tracks.energy is 'low | mid | high; tagger output, see tag_source for how far to trust it';
comment on column public.pool_tracks.daypart is 'parts of the day this track suits; raga stays null unless the track is truly in that raga';
