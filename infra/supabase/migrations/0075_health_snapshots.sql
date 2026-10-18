-- 0075_health_snapshots.sql
-- One row per UTC day holding the ops health summary and funnel as they stood when the daily snapshot ran,
-- so /admin/health can draw 7- and 30-day trends. Operational aggregates only; top-spender ids are stripped
-- before insert. Written and read by the service role alone (RLS on, no policies, no grants to anon/authenticated).

create table if not exists public.health_snapshots (
  day date primary key,
  summary jsonb not null,
  funnel jsonb,
  created_at timestamptz not null default now()
);
alter table public.health_snapshots enable row level security;
revoke all on public.health_snapshots from anon, authenticated;
