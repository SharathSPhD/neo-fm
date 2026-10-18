-- 0093_station_signals.sql
-- Listener signals from /station (play, like, skip, replay, share, finish). Own-row only; ranking v0 reads them
-- server-side per listener. track_id has no foreign key on purpose: the pool schema is owned by another migration
-- and a retired track must not block deleting signals.

create table if not exists public.station_signals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id uuid not null,
  kind text not null check (kind in ('play', 'like', 'skip', 'replay', 'share', 'finish')),
  position_ms int check (position_ms is null or position_ms >= 0),
  created_at timestamptz not null default now()
);
create index if not exists station_signals_user_created_idx on public.station_signals (user_id, created_at desc);
create index if not exists station_signals_track_idx on public.station_signals (track_id, kind);
alter table public.station_signals enable row level security;
revoke all on public.station_signals from public, anon, authenticated;
grant select, insert, delete on public.station_signals to service_role;
