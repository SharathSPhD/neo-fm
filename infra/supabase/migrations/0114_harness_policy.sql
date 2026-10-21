-- 0114_harness_policy.sql
-- Harness policy (HARNESS_POLICY=1): which lyric-harness arm each language/tier uses, the Beta posteriors it learns, and the arm
-- each job was given so listener events can be attributed to it. Server-side only (service role); no user can read or write these.
-- The web code treats a missing table as "policy off" and falls back to the env flags, so this can be applied after the code ships. Idempotent.

create table if not exists public.harness_policy (
  language text not null,
  tier text not null default '*',
  arm_id text not null,
  role text not null default 'champion' check (role in ('champion', 'challenger')),
  max_share numeric not null default 0.15 check (max_share >= 0 and max_share <= 1),
  created_at timestamptz not null default now(),
  primary key (language, tier, arm_id)
);

create table if not exists public.harness_arm_stats (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  language text not null,
  tier text not null default '*',
  arm_id text not null,
  a numeric not null default 1,
  b numeric not null default 1,
  updated_at timestamptz not null default now()
);
create unique index if not exists harness_arm_stats_scope_idx
  on public.harness_arm_stats (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), language, tier, arm_id);

create table if not exists public.harness_arm_choices (
  job_id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  language text not null,
  tier text not null,
  arm_id text not null,
  source text not null check (source in ('policy', 'flags')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  reward numeric
);
create index if not exists harness_arm_choices_open_idx on public.harness_arm_choices (created_at) where settled_at is null;

alter table public.harness_policy enable row level security;
alter table public.harness_arm_stats enable row level security;
alter table public.harness_arm_choices enable row level security;
revoke all on public.harness_policy, public.harness_arm_stats, public.harness_arm_choices from public, anon, authenticated;
grant select, insert, update, delete on public.harness_policy, public.harness_arm_stats, public.harness_arm_choices to service_role;
grant usage, select on sequence public.harness_arm_stats_id_seq to service_role;
