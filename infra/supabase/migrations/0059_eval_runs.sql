-- 0059_eval_runs.sql
-- Offline lyric-quality evaluation: PCE engine output vs a single-shot LLM baseline, judged blind (see apps/web/lib/eval).
create table if not exists public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  batch text not null,
  brief_id text not null,
  language text not null,
  style_family text not null,
  brief text not null,
  arm text not null check (arm in ('pce','single')),
  session_id text,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  lyrics text,
  config_version_id uuid references public.config_versions(id),
  error text,
  created_at timestamptz not null default now(),
  unique (batch, brief_id, arm)
);
create table if not exists public.eval_judgments (
  id uuid primary key default gen_random_uuid(),
  batch text not null,
  brief_id text not null,
  winner text not null check (winner in ('pce','single','tie')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (batch, brief_id)
);
alter table public.eval_runs enable row level security;
alter table public.eval_judgments enable row level security;
-- service role only (no policies)
