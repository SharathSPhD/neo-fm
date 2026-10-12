-- neo-fm-prod bootstrap, part 3 of 3 (run after part2 succeeded).

-- ======== 0051_managed_agent_runs.sql ========
-- 0051_managed_agent_runs.sql
-- Cloud (Managed Agents) job pipeline: per-job run state and a hard spend ledger
-- for paid third-party calls (Lyria). Written/read only by the service role.

create table if not exists public.agent_runs (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  session_id text,
  agent_key text not null default 'free' check (agent_key in ('free','pro')),
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  lyria_calls integer not null default 0,
  audio_path text,
  lyrics text,
  agent_song_document jsonb,
  updated_at timestamptz not null default now()
);
alter table public.agent_runs enable row level security;
-- No policies: authenticated/anon cannot read or write; service role bypasses RLS.

create table if not exists public.spend_ledger (
  provider text primary key,
  reserved_gbp numeric(10,4) not null default 0 check (reserved_gbp >= 0),
  updated_at timestamptz not null default now()
);
alter table public.spend_ledger enable row level security;

-- Atomic reserve: row-locks the provider row so concurrent workers cannot overshoot the cap.
create or replace function public.reserve_spend(p_provider text, p_amount numeric, p_cap numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_cur numeric;
begin
  insert into public.spend_ledger(provider) values (p_provider) on conflict do nothing;
  select reserved_gbp into v_cur from public.spend_ledger where provider = p_provider for update;
  if v_cur + p_amount > p_cap then
    return false;
  end if;
  update public.spend_ledger set reserved_gbp = v_cur + p_amount, updated_at = now() where provider = p_provider;
  return true;
end $$;

create or replace function public.release_spend(p_provider text, p_amount numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update public.spend_ledger
     set reserved_gbp = greatest(0, reserved_gbp - p_amount), updated_at = now()
   where provider = p_provider;
$$;

revoke all on function public.reserve_spend(text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.release_spend(text, numeric) from public, anon, authenticated;
grant execute on function public.reserve_spend(text, numeric, numeric) to service_role;
grant execute on function public.release_spend(text, numeric) to service_role;

-- ======== 0052_claim_render.sql ========
-- 0052_claim_render.sql
-- Atomic render counter: returns the new count, or NULL when the per-run limit is already reached.
-- Independent of any read path, so a stale read can never cause an extra paid render.
create or replace function public.claim_render(p_job_id uuid, p_max integer)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.agent_runs
     set lyria_calls = lyria_calls + 1, updated_at = now()
   where job_id = p_job_id and lyria_calls < p_max
  returning lyria_calls;
$$;
revoke all on function public.claim_render(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_render(uuid, integer) to service_role;

-- ======== 0053_users_agent_plan_override.sql ========
-- 0053_users_agent_plan_override.sql
-- Lets an account use a specific agent plan regardless of billing tier (e.g. a showcase account that
-- needs unlimited quota but should only ever render cheap Lyria clips).
alter table public.users add column if not exists agent_plan text check (agent_plan in ('free','pro'));
comment on column public.users.agent_plan is 'Optional override of the tier-derived Managed Agents plan: free (clip only) or pro.';

-- ======== 0054_job_agent_lease.sql ========
-- Per-job worker lease so the cron tick and the pull-based poll never advance one job concurrently.
alter table public.jobs add column if not exists agent_lease_until timestamptz;

-- ======== 0055_user_spend.sql ========
-- 0055_user_spend.sql
-- Per-user, per-month spend reservations on top of the global ceiling, so one user can neither exhaust the
-- shared Lyria budget nor exceed their tier's cost envelope. Atomic: both rows are locked in one transaction.

create table if not exists public.user_spend (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  period date not null default date_trunc('month', now())::date,
  reserved_gbp numeric(10,4) not null default 0 check (reserved_gbp >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider, period)
);
alter table public.user_spend enable row level security;
-- No policies: service role only.

create or replace function public.reserve_user_spend(
  p_user uuid, p_provider text, p_amount numeric, p_user_cap numeric, p_global_cap numeric
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_global numeric; v_user numeric; v_period date := date_trunc('month', now())::date;
begin
  insert into public.spend_ledger(provider) values (p_provider) on conflict do nothing;
  insert into public.user_spend(user_id, provider, period) values (p_user, p_provider, v_period) on conflict do nothing;
  -- fixed lock order (global, then user) avoids deadlocks between concurrent reservations
  select reserved_gbp into v_global from public.spend_ledger where provider = p_provider for update;
  select reserved_gbp into v_user from public.user_spend
   where user_id = p_user and provider = p_provider and period = v_period for update;
  if v_global + p_amount > p_global_cap or v_user + p_amount > p_user_cap then
    return false;
  end if;
  update public.spend_ledger set reserved_gbp = v_global + p_amount, updated_at = now() where provider = p_provider;
  update public.user_spend set reserved_gbp = v_user + p_amount, updated_at = now()
   where user_id = p_user and provider = p_provider and period = v_period;
  return true;
end $$;

create or replace function public.release_user_spend(p_user uuid, p_provider text, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_period date := date_trunc('month', now())::date;
begin
  update public.spend_ledger set reserved_gbp = greatest(0, reserved_gbp - p_amount), updated_at = now() where provider = p_provider;
  update public.user_spend set reserved_gbp = greatest(0, reserved_gbp - p_amount), updated_at = now()
   where user_id = p_user and provider = p_provider and period = v_period;
end $$;

revoke all on function public.reserve_user_spend(uuid, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.release_user_spend(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.reserve_user_spend(uuid, text, numeric, numeric, numeric) to service_role;
grant execute on function public.release_user_spend(uuid, text, numeric) to service_role;

-- ======== 0056_diction_qa.sql ========
-- Post-render diction audit (Gemini transcription vs intended lyrics), stored per run and shown on the song page.
alter table public.agent_runs add column if not exists diction_qa jsonb;

-- ======== 0057_memory_telemetry.sql ========
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
    'qa_model', 'gemini-2.5-flash'),
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
