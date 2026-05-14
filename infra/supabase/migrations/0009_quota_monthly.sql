-- 0009_quota_monthly.sql -- quota reconciliation + ADR 0005 byte caps
--
-- ADR 0009 (this file): the quota window is **monthly**, not daily, and the
-- tier caps are aligned with PRD §10 (free = 3 songs/month). The old daily
-- helpers are replaced in-place via create-or-replace.
--
-- ADR 0005: per-tier storage byte caps (free 500 MB, creator 5 GB, pro 50 GB)
-- are now enforced server-side inside the create_song_job RPC. Storage cost
-- is the highest-variance hidden cost on the free tier; honoring ADR 0005 in
-- the data layer (not in application code) makes it impossible to bypass.
--
-- All function changes use `create or replace` so the migration is idempotent
-- and replays cleanly against environments that already have the prior
-- Phase 4 migrations applied.

-- ---------------------------------------------------------------------------
-- 1. Monthly job-count window
-- ---------------------------------------------------------------------------

-- The historical name was user_jobs_count_today; the body is rewritten to
-- count the current calendar UTC month so existing call sites get the new
-- semantics without a code change. The old name is preserved so external
-- tooling / dashboards do not break.
create or replace function public.user_jobs_count_today(p_user_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::int
  from public.jobs
  where user_id = p_user_id
    and created_at >= date_trunc('month', now() at time zone 'utc');
$$;

comment on function public.user_jobs_count_today(uuid) is
  'ADR 0009: name preserved for backwards compatibility; body now counts the current UTC month, not the current UTC day. The monthly window matches PRD §10.';

-- Canonical name going forward. Cloud API + tests should prefer this.
create or replace function public.user_jobs_count_month(p_user_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select public.user_jobs_count_today(p_user_id);
$$;

comment on function public.user_jobs_count_month(uuid) is
  'ADR 0009: canonical monthly job counter. Currently delegates to the legacy user_jobs_count_today() body. Prefer this name in new code.';

-- ---------------------------------------------------------------------------
-- 2. Tier caps (monthly)
-- ---------------------------------------------------------------------------

create or replace function public.user_tier_quota(p_user_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select case coalesce(u.tier, 'free'::public.tier_enum)
    when 'free'    then 3
    when 'creator' then 100
    when 'pro'     then 1000
  end
  from public.users u where u.id = p_user_id;
$$;

comment on function public.user_tier_quota(uuid) is
  'ADR 0009: songs-per-month cap by tier. free=3 (PRD §10), creator=100, pro=1000.';

-- ---------------------------------------------------------------------------
-- 3. ADR 0005 byte caps (free 500 MB, creator 5 GB, pro 50 GB)
-- ---------------------------------------------------------------------------

create or replace function public.user_tier_storage_bytes_cap(p_user_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select case coalesce(u.tier, 'free'::public.tier_enum)
    when 'free'    then 524288000::bigint     -- 500 MB
    when 'creator' then 5368709120::bigint    -- 5 GB
    when 'pro'     then 53687091200::bigint   -- 50 GB
  end
  from public.users u where u.id = p_user_id;
$$;

comment on function public.user_tier_storage_bytes_cap(uuid) is
  'ADR 0005 / ADR 0009: per-tier storage byte cap. Soft-deleted tracks (deleted_at not null) do not count against the cap; expired tracks do, until garbage-collected by the Phase 11 sweep.';

-- View of currently-counted bytes per user. Soft-deleted tracks are excluded;
-- a track with deleted_at set is considered already returned to the pool.
--
-- `security_invoker = true` is required (PG 15+, Supabase default lint 0010):
-- without it the view runs with the creator's permissions, side-stepping the
-- RLS on `public.jobs` / `public.tracks`. With it, the caller's role is what
-- matters, which is what we want.
create or replace view public.v_user_storage_bytes
  with (security_invoker = true) as
  select
    t.job_id,
    j.user_id,
    sum(coalesce(t.bytes, 0))::bigint as bytes
  from public.tracks t
  join public.jobs j on j.id = t.job_id
  where t.deleted_at is null
  group by t.job_id, j.user_id;

comment on view public.v_user_storage_bytes is
  'ADR 0005 / ADR 0009: live byte usage per user. Sum across (user_id) gives the value compared to user_tier_storage_bytes_cap() before enqueueing a new job. Bytes is null until the worker fills tracks.bytes; coalesce keeps the math defensive.';

-- Convenience helper: total live bytes for one user. Used inside the create
-- RPC so plpgsql does not have to inline the group-by.
create or replace function public.user_storage_bytes(p_user_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(bytes), 0)::bigint
  from public.v_user_storage_bytes
  where user_id = p_user_id;
$$;

comment on function public.user_storage_bytes(uuid) is
  'ADR 0005 / ADR 0009: sum of bytes across all non-soft-deleted tracks for a user. Cheap because tracks.user_id is reached via jobs and indexed.';

-- ---------------------------------------------------------------------------
-- 4. Atomic create_song_job — monthly window + byte cap
-- ---------------------------------------------------------------------------
--
-- Same signature as before so callers do not change. The body now:
--   - reads the monthly count via user_jobs_count_month()
--   - estimates the new job's bytes from target_duration_seconds * ~25 KB/sec
--     (MP3 192 kbps lower bound) and rejects if user_storage_bytes + estimate
--     would exceed the tier cap
--   - keeps the per-user transaction-scoped advisory lock from the earlier
--     adversarial fix (TOCTOU resolution).

create or replace function public.create_song_job(
  p_song_document jsonb,
  p_language public.language_enum,
  p_style_family public.style_family_enum,
  p_target_duration_seconds integer,
  p_priority integer default 0,
  p_attempt_id uuid default null,
  p_trace_id text default null
) returns table (
  job_id uuid,
  song_id uuid,
  status public.job_status_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_used integer;
  v_quota integer;
  v_used_bytes bigint;
  v_bytes_cap bigint;
  v_estimated_bytes bigint;
  v_doc_id uuid;
  v_job_id uuid;
  v_attempt_id uuid := coalesce(p_attempt_id, gen_random_uuid());
  v_trace_id text := coalesce(p_trace_id, gen_random_uuid()::text);
  v_payload jsonb;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_target_duration_seconds not in (30, 60, 90, 180) then
    raise exception 'invalid_target_duration_seconds' using errcode = '22023';
  end if;

  -- Per-user transaction-scoped advisory lock. Two concurrent calls for the
  -- same user serialize here; concurrent calls for *different* users do not
  -- block each other.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  v_used := public.user_jobs_count_month(v_user_id);
  v_quota := coalesce(public.user_tier_quota(v_user_id), 3);

  if v_used >= v_quota then
    raise exception 'quota_exceeded' using errcode = '22023';
  end if;

  -- MP3 192 kbps ≈ 24 KB/sec; use 25 KB/sec for headroom. WAV-retaining
  -- paid tiers absorb the 10× difference inside their generous caps.
  v_estimated_bytes := (p_target_duration_seconds * 25000)::bigint;
  v_used_bytes := public.user_storage_bytes(v_user_id);
  v_bytes_cap  := coalesce(public.user_tier_storage_bytes_cap(v_user_id), 524288000);

  if v_used_bytes + v_estimated_bytes > v_bytes_cap then
    raise exception 'storage_quota_exceeded' using errcode = '22023';
  end if;

  insert into public.song_documents (user_id, language, style_family, document_json)
  values (v_user_id, p_language, p_style_family, p_song_document)
  returning id into v_doc_id;

  insert into public.jobs (
    user_id, song_document_id, status, priority, progress,
    attempts, attempt_id, trace_id
  )
  values (
    v_user_id, v_doc_id, 'queued', p_priority, 0,
    0, v_attempt_id, v_trace_id
  )
  returning id into v_job_id;

  v_payload := jsonb_build_object(
    'job_id', v_job_id,
    'user_id', v_user_id,
    'song_document_id', v_doc_id,
    'priority', case when p_priority >= 1 then 'high' else 'normal' end,
    'created_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'style_family', p_style_family,
    'target_duration_seconds', p_target_duration_seconds,
    'attempt_id', v_attempt_id,
    'attempt_number', 1,
    'trace_id', v_trace_id
  );

  perform public.enqueue_song_generation_job(v_payload);

  return query select v_job_id, v_doc_id, 'queued'::public.job_status_enum;
end;
$$;

-- Re-grant: the function signature is unchanged so existing grants persist,
-- but state them explicitly for the audit trail and so a fresh-DB replay of
-- 0001..0009 reaches the same end state regardless of whether 0008 ran first.
revoke execute on function public.create_song_job(
  jsonb, public.language_enum, public.style_family_enum, integer, integer, uuid, text
) from public, anon;
grant execute on function public.create_song_job(
  jsonb, public.language_enum, public.style_family_enum, integer, integer, uuid, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. neo_fm_worker grants on the new helpers
-- ---------------------------------------------------------------------------
--
-- The worker does not enqueue, so it does not call create_song_job, but the
-- byte-cap view + helper are part of the schema surface and consumers might
-- (e.g. a future quota dashboard read by the worker for self-throttling).
grant select on public.v_user_storage_bytes to neo_fm_worker;
grant execute on function public.user_storage_bytes(uuid)              to neo_fm_worker;
grant execute on function public.user_tier_storage_bytes_cap(uuid)     to neo_fm_worker;
grant execute on function public.user_jobs_count_month(uuid)           to neo_fm_worker;
