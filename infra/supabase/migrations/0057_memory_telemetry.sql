-- 0057_memory_telemetry.sql
-- Memory + governance foundations for personalization and guarded self-improvement (see managed-agents/SPEC.md):
--   config_versions / job_assignments  : every job is attributable to a pipeline config version
--   job_telemetry                      : per-job phase/cost/latency/engine metrics
--   feedback_events                    : user signals (like, play %, regenerate, ...)
--   consents                           : per-purpose consent (DPDP)
--   taste_profiles                     : derived, user-visible, user-deletable profile
-- Also fixes the spend ledger: monthly global ceiling (sum of the period's user rows) and explicit period on release.

create table if not exists public.config_versions (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'pipeline',
  payload jsonb not null,
  parent uuid references public.config_versions(id),
  status text not null default 'draft' check (status in ('draft','shadow','canary','live','retired')),
  eval_report jsonb,
  approved_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists config_versions_one_live on public.config_versions(kind) where status = 'live';
alter table public.config_versions enable row level security;

insert into public.config_versions(kind, payload, status, approved_by)
select 'pipeline',
  jsonb_build_object(
    'name', 'v1-gemma-cascade',
    'embedder', 'embeddinggemma-300m',
    'aspect_cosine_hit', 0.15,
    'k_free', 3, 'k_pro', 6,
    'free_model', 'claude-haiku-5-5', 'pro_model', 'claude-sonnet-5-5', 'polisher', 'claude-opus-5-5',
    'qa_model', 'gemini-3.8-flash'),
  'live', 'bootstrap'
where not exists (select 1 from public.config_versions where kind = 'pipeline' and status = 'live');

create table if not exists public.job_assignments (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  config_version_id uuid not null references public.config_versions(id),
  arm text not null default 'control',
  created_at timestamptz not null default now()
);
alter table public.job_assignments enable row level security;

create table if not exists public.job_telemetry (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  config_version_id uuid references public.config_versions(id),
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.job_telemetry enable row level security;

create table if not exists public.feedback_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  kind text not null check (kind in ('play_pct','replay','like','dislike','share','download','regenerate','lyric_pick','line_edit','report','abandon')),
  value numeric,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists feedback_events_user_idx on public.feedback_events(user_id, created_at desc);
alter table public.feedback_events enable row level security;
create policy feedback_events_insert_own on public.feedback_events for insert to authenticated with check (user_id = auth.uid());
create policy feedback_events_select_own on public.feedback_events for select to authenticated using (user_id = auth.uid());
create policy feedback_events_delete_own on public.feedback_events for delete to authenticated using (user_id = auth.uid());

create table if not exists public.consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('personalize','improve','public_exemplar')),
  version text not null,
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  primary key (user_id, purpose)
);
alter table public.consents enable row level security;
create policy consents_own on public.consents for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.taste_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weights jsonb not null default '{}'::jsonb,
  avoid_phrases text[] not null default '{}',
  summary text,
  n_signals integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.taste_profiles enable row level security;
create policy taste_profiles_select_own on public.taste_profiles for select to authenticated using (user_id = auth.uid());
create policy taste_profiles_delete_own on public.taste_profiles for delete to authenticated using (user_id = auth.uid());

-- Spend ledger fix: global ceiling is monthly (sum of user rows for the period); release names its period.
create or replace function public.reserve_user_spend(
  p_user uuid, p_provider text, p_amount numeric, p_user_cap numeric, p_global_cap numeric
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_global numeric; v_user numeric; v_period date := date_trunc('month', now())::date;
begin
  insert into public.user_spend(user_id, provider, period) values (p_user, p_provider, v_period) on conflict do nothing;
  perform pg_advisory_xact_lock(hashtext('spend:' || p_provider));
  select coalesce(sum(reserved_gbp), 0) into v_global from public.user_spend where provider = p_provider and period = v_period;
  select reserved_gbp into v_user from public.user_spend where user_id = p_user and provider = p_provider and period = v_period for update;
  if v_global + p_amount > p_global_cap or v_user + p_amount > p_user_cap then return false; end if;
  update public.user_spend set reserved_gbp = v_user + p_amount, updated_at = now()
   where user_id = p_user and provider = p_provider and period = v_period;
  return true;
end $$;
create or replace function public.release_user_spend(p_user uuid, p_provider text, p_amount numeric, p_period date)
returns void
language sql security definer set search_path = public as $$
  update public.user_spend set reserved_gbp = greatest(0, reserved_gbp - p_amount), updated_at = now()
   where user_id = p_user and provider = p_provider and period = p_period;
$$;
revoke all on function public.reserve_user_spend(uuid, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.release_user_spend(uuid, text, numeric, date) from public, anon, authenticated;
grant execute on function public.reserve_user_spend(uuid, text, numeric, numeric, numeric) to service_role;
grant execute on function public.release_user_spend(uuid, text, numeric, date) to service_role;
