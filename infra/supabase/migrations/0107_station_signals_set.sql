-- 0107_station_signals_set.sql: which set block a played track belonged to and its place in it, so block length is measurable.
-- Two nullable columns on station_signals; no new access. The app keeps storing plain signals until this is applied.
alter table public.station_signals
  add column if not exists set_id text check (set_id is null or set_id ~ '^set[0-9]{1,4}$'),
  add column if not exists set_index smallint check (set_index is null or (set_index >= 0 and set_index <= 9));
