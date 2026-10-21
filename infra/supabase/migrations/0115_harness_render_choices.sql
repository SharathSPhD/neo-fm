-- 0115_harness_render_choices.sql
-- Render-side harness arms (HARNESS_POLICY=1, arm ids "r_*" in harness_policy / harness_arm_stats): which romanization and style-line
-- arm each job's render used, so the stored Gemini diction match and listener events can be attributed to it. Server-side only.
-- The web code treats a missing table as "policy off" for the render step (env flags decide). Idempotent.

create table if not exists public.harness_render_choices (
  job_id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  language text not null,
  tier text not null,
  arm_id text not null,
  source text not null check (source in ('policy', 'flags')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  reward numeric,
  diction numeric
);
create index if not exists harness_render_choices_open_idx on public.harness_render_choices (created_at) where settled_at is null;

alter table public.harness_render_choices enable row level security;
revoke all on public.harness_render_choices from public, anon, authenticated;
grant select, insert, update, delete on public.harness_render_choices to service_role;
