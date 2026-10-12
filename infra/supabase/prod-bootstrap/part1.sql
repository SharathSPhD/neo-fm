-- neo-fm-prod bootstrap, part 1 of 3.
-- Context: migrations 0001-0008 were already applied through the Supabase MCP, which cannot execute DROP statements.
-- That left two policies that 0008 is supposed to remove; remove them first (exactly what 0008 lines 115-116 do).
drop policy if exists song_documents_insert_own on public.song_documents;
drop policy if exists jobs_insert_own on public.jobs;

-- ======== 0009_quota_monthly.sql ========
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

-- ======== 0010_worker_bypassrls.sql ========
-- 0010_worker_bypassrls.sql -- let neo_fm_worker bypass RLS (ADR 0004 follow-up)
--
-- 0006 said "RLS does not apply to this role" but that is wrong: when RLS is
-- enabled on a table and no policy lists `neo_fm_worker`, the role sees zero
-- rows. The worker's first CAS update against `public.jobs` therefore
-- returned 0 rows and the worker archived the message as "not claimable".
--
-- The principled fix is BYPASSRLS, matching what Supabase already does for
-- `service_role`. Least-privilege is still preserved by the column-level
-- UPDATE grants from 0006 (only the lifecycle columns), the absence of any
-- grant on `public.users` / `public.subscriptions`, and the absence of
-- DELETE on `public.jobs`. RLS was redundant for this role: it never had
-- INSERT-by-mistake risk because the column grants gate that already.
--
-- Adding a per-role policy with `using (true) ... to neo_fm_worker` would be
-- functionally identical to BYPASSRLS while being more code to maintain.

alter role neo_fm_worker bypassrls;

comment on role neo_fm_worker is
  'ADR 0004: dedicated least-privilege role for services/dgx-worker. '
  'Has BYPASSRLS (matching service_role); least-privilege is enforced by '
  'column-level UPDATE grants on public.jobs (lifecycle columns only) and '
  'the absence of any grant on public.users / public.subscriptions / no '
  'DELETE on public.jobs.';

-- ======== 0011_realtime_publication.sql ========
-- 0011_realtime_publication.sql -- publish jobs + tracks for Phase 5 realtime
--
-- Phase 5's library page subscribes to postgres_changes on `public.jobs`
-- via Supabase Realtime. That subscription is silently a no-op unless the
-- table is a member of the `supabase_realtime` publication. The earlier
-- migrations (0001-0010) never altered the publication, so the UI showed
-- "Queued" forever even after the worker wrote `status = 'completed'`.
--
-- This migration:
--   * adds public.jobs + public.tracks to `supabase_realtime` so the
--     library page's UPDATE/INSERT subscription works,
--   * sets REPLICA IDENTITY DEFAULT (PK only) - the UI only consumes the
--     new-record payload so we don't pay the WAL cost of FULL.
--
-- song_documents is intentionally NOT added: they are immutable after
-- insert and the UI doesn't subscribe to them.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'jobs'
  ) then
    alter publication supabase_realtime add table public.jobs;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tracks'
  ) then
    alter publication supabase_realtime add table public.tracks;
  end if;
end $$;

-- REPLICA IDENTITY DEFAULT is the cheapest choice and gives the UI
-- everything it needs (new-record payload). If a future surface needs the
-- pre-update column values, bump these to FULL.
alter table public.jobs   replica identity default;
alter table public.tracks replica identity default;

-- ======== 0012_section_regen.sql ========
-- 0012_section_regen.sql -- section-level regeneration (M5)
--
-- Sprint 2 adds the ability to regenerate a single section of an already-
-- completed song without redoing the whole composition. The user picks a
-- section on the /songs/[id] detail page, hits "regenerate", and a new
-- job runs against just that section. When it completes, the new section
-- audio is mixed back into the song.
--
-- This migration is **additive**: it leaves all existing columns and
-- functions intact. The detail-page render path and the existing
-- create_song_job RPC continue to work unchanged.
--
-- New surface:
--   1. `jobs.parent_job_id` -- when a regen job is created, this points
--      at the original full-song job. Lets the detail page show the
--      regen history and lets the worker know to mix the new section
--      back into the parent's track.
--   2. `jobs.section_id` -- the Song Document section.id being
--      regenerated. NULL for normal full-song jobs.
--   3. `create_section_regen_job` RPC -- analogous to create_song_job
--      but for the partial case. Enforces:
--        - the parent job is owned by the caller
--        - the parent is `completed` (no partial regen on a half-done job)
--        - the section_id appears in the parent's song_document
--        - the user has remaining monthly quota (regen counts as 1 job)
--      Returns the new job_id + attempt_id.
--   4. Queue payload carries `section_id` and `parent_job_id` so the
--      worker can route to a regen-aware code path. Until Phase 5 lands
--      the real section mixer, the worker can no-op these and the API
--      will surface as "ready for Phase 5". This migration is forward-
--      compatible: enqueuing the message is harmless.

alter table public.jobs
  add column if not exists parent_job_id uuid references public.jobs(id) on delete cascade;

alter table public.jobs
  add column if not exists section_id text;

create index if not exists jobs_parent_job_id_idx
  on public.jobs (parent_job_id) where parent_job_id is not null;

comment on column public.jobs.parent_job_id is
  'Sprint 2 M5: when this job is a section-level regen, points at the original full-song job. NULL for top-level full-song jobs. The detail page reads this to render regen history; the worker reads it to mix the new section back into the parent track.';
comment on column public.jobs.section_id is
  'Sprint 2 M5: the SongDocument section.id this job (re)generates. NULL when the job covers the whole song.';

create or replace function public.create_section_regen_job(
  p_parent_job_id uuid,
  p_section_id text,
  p_attempt_id uuid default null,
  p_trace_id text default null
) returns table (
  job_id uuid,
  parent_job_id uuid,
  section_id text,
  status public.job_status_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_parent record;
  v_used integer;
  v_quota integer;
  v_doc jsonb;
  v_section_found boolean;
  v_new_job_id uuid;
  v_attempt_id uuid := coalesce(p_attempt_id, gen_random_uuid());
  v_trace_id text := coalesce(p_trace_id, gen_random_uuid()::text);
  v_payload jsonb;
  v_section_target integer;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Lock against the user before any state read so concurrent regen
  -- attempts on the same song serialize cleanly.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select j.id,
         j.user_id,
         j.status,
         j.song_document_id,
         sd.document_json,
         sd.language,
         sd.style_family
    into v_parent
    from public.jobs j
    join public.song_documents sd on sd.id = j.song_document_id
   where j.id = p_parent_job_id;

  if v_parent.id is null then
    raise exception 'parent_job_not_found' using errcode = '42704';
  end if;
  if v_parent.user_id <> v_user_id then
    -- Same 404-shaped error as a missing row so we don't leak
    -- existence of other users' jobs through the error message.
    raise exception 'parent_job_not_found' using errcode = '42704';
  end if;
  if v_parent.status <> 'completed' then
    raise exception 'parent_job_not_completed' using errcode = '22023';
  end if;

  v_doc := v_parent.document_json;
  -- Confirm the section_id actually exists in the parent document.
  select exists (
    select 1
    from jsonb_array_elements(v_doc -> 'sections') as s
    where s ->> 'id' = p_section_id
  ),
  (
    select (s ->> 'target_seconds')::integer
    from jsonb_array_elements(v_doc -> 'sections') as s
    where s ->> 'id' = p_section_id
    limit 1
  )
  into v_section_found, v_section_target;

  if not v_section_found then
    raise exception 'section_not_in_document' using errcode = '22023';
  end if;

  v_used := public.user_jobs_count_today(v_user_id);
  v_quota := coalesce(public.user_tier_quota(v_user_id), 5);
  if v_used >= v_quota then
    raise exception 'quota_exceeded' using errcode = '22023';
  end if;

  insert into public.jobs (
    user_id, song_document_id, status, priority, progress,
    attempts, attempt_id, trace_id, parent_job_id, section_id
  )
  values (
    v_user_id, v_parent.song_document_id, 'queued', 0, 0,
    0, v_attempt_id, v_trace_id, p_parent_job_id, p_section_id
  )
  returning id into v_new_job_id;

  v_payload := jsonb_build_object(
    'job_id', v_new_job_id,
    'parent_job_id', p_parent_job_id,
    'section_id', p_section_id,
    'user_id', v_user_id,
    'song_document_id', v_parent.song_document_id,
    'priority', 'normal',
    'created_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'style_family', v_parent.style_family,
    'target_duration_seconds', coalesce(v_section_target, 30),
    'attempt_id', v_attempt_id,
    'attempt_number', 1,
    'trace_id', v_trace_id,
    'is_section_regen', true
  );

  perform public.enqueue_song_generation_job(v_payload);

  return query
    select v_new_job_id,
           p_parent_job_id,
           p_section_id,
           'queued'::public.job_status_enum;
end;
$$;

revoke execute on function public.create_section_regen_job(uuid, text, uuid, text)
  from public, anon;
grant execute on function public.create_section_regen_job(uuid, text, uuid, text)
  to authenticated;

comment on function public.create_section_regen_job(uuid, text, uuid, text) is
  'Sprint 2 M5: atomic section-level regeneration job. Asserts parent ownership + completion, validates the section_id exists in the parent SongDocument, enforces monthly quota, inserts a child jobs row, and enqueues a regen-flagged pgmq message. Phase 5 (vocal-synth / mixer) will wire the worker to mix the regen output back into the parent track; until then the message is enqueued harmlessly.';

-- ======== 0013_public_songs.sql ========
-- 0013_public_songs.sql -- public share surface (M1)
--
-- Sprint 3 adds a publish/share surface for completed songs:
--
--   1. Owner hits "Share" on /songs/[id] -> calls publish_song(...) which:
--        - verifies caller owns the job and it is `completed`
--        - mints a stable, URL-safe `public_id` slug (Crockford-style base32,
--          10 chars, ~50 bits entropy) on first publish; reuses it after
--          unpublish/re-publish so the link stays portable
--        - sets `published_visibility` (public | unlisted | private) and
--          `published_at`
--
--   2. The public song page at /s/[publicId] reads the job + song document +
--      latest track via the service-role client (no auth required) and renders
--      the song. Audio is served via a short-lived signed URL minted on the
--      same request (ADR 0012 Tier 1) with a public refetch endpoint
--      (Tier 2) so long-running browser sessions keep working.
--
--   3. RLS is widened ONLY for SELECT on jobs / tracks / song_documents
--      when published_visibility in ('public','unlisted'). Insert/update/delete
--      policies are unchanged: an unauthenticated visitor cannot mutate.
--      The public-mint endpoints use service_role to bypass RLS for storage
--      signing; the gate is enforced in the API + this column.
--
-- ADR 0013 owns the design.
--
-- This migration is **additive**: existing columns and policies are kept.

create extension if not exists pgcrypto with schema extensions;

-- 1. Visibility enum (new) + columns on public.jobs ----------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'song_visibility_enum' and n.nspname = 'public'
  ) then
    create type public.song_visibility_enum as enum (
      'private',
      'unlisted',
      'public'
    );
  end if;
end
$$;

alter table public.jobs
  add column if not exists public_id text;

alter table public.jobs
  add column if not exists published_at timestamptz;

alter table public.jobs
  add column if not exists published_visibility public.song_visibility_enum
  not null default 'private';

create unique index if not exists jobs_public_id_unique
  on public.jobs (public_id)
  where public_id is not null;

create index if not exists jobs_published_idx
  on public.jobs (published_visibility, published_at)
  where published_visibility <> 'private';

comment on column public.jobs.public_id is
  'Stable URL-safe slug used for /s/[publicId]. NULL until the owner publishes for the first time. Survives unpublish so links stay portable.';
comment on column public.jobs.published_visibility is
  'public = listed + shareable; unlisted = shareable only via link; private = not shareable. RLS widens SELECT only for public/unlisted.';

-- 2. Slug generator ----------------------------------------------------------
--
-- Crockford base32 alphabet (no 0/O, no 1/I, no U). 32 chars, so each char
-- carries 5 bits of entropy. 10 chars = 50 bits, ~1.1e15 combinations.
-- Collision risk at 1e6 published songs is < 1e-3 -- and the publish RPC
-- retries on the unique-index violation anyway.

create or replace function public.gen_public_id()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet text := '0123456789abcdefghjkmnpqrstvwxyz';
  bytes bytea;
  out text := '';
  i integer;
begin
  bytes := extensions.gen_random_bytes(10);
  for i in 0..9 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return out;
end;
$$;

revoke all on function public.gen_public_id() from public;
grant execute on function public.gen_public_id() to authenticated, service_role;

-- 3. Publish/unpublish RPC ---------------------------------------------------

create or replace function public.publish_song(
  p_job_id uuid,
  p_visibility text
)
returns table (
  public_id text,
  visibility public.song_visibility_enum,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.job_status_enum;
  v_owner uuid;
  v_existing_public_id text;
  v_visibility public.song_visibility_enum;
  v_new_public_id text;
  v_attempts integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  -- cast + validate visibility argument
  begin
    v_visibility := p_visibility::public.song_visibility_enum;
  exception when others then
    raise exception 'invalid visibility: %', p_visibility
      using errcode = '22023';
  end;

  select j.user_id, j.status, j.public_id
    into v_owner, v_status, v_existing_public_id
    from public.jobs j
    where j.id = p_job_id;

  if v_owner is null then
    raise exception 'song not found'
      using errcode = 'P0002';
  end if;

  if v_owner <> v_uid then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if v_status <> 'completed' then
    raise exception 'song is not completed (status=%)', v_status
      using errcode = '22023';
  end if;

  -- Only mint a new slug if there is no existing one. Re-publishing
  -- after unpublish reuses the original slug so links remain stable.
  if v_existing_public_id is null and v_visibility <> 'private' then
    loop
      v_new_public_id := public.gen_public_id();
      v_attempts := v_attempts + 1;
      begin
        update public.jobs
           set public_id = v_new_public_id,
               published_visibility = v_visibility,
               published_at = now()
         where id = p_job_id;
        exit;
      exception when unique_violation then
        if v_attempts > 8 then
          raise exception 'failed to mint unique public_id after % attempts',
            v_attempts;
        end if;
      end;
    end loop;
  else
    update public.jobs
       set published_visibility = v_visibility,
           published_at = case
             when v_visibility = 'private' then null
             when v_existing_public_id is null then now()
             else coalesce(published_at, now())
           end
     where id = p_job_id;
  end if;

  return query
    select j.public_id, j.published_visibility, j.published_at
      from public.jobs j
      where j.id = p_job_id;
end;
$$;

revoke all on function public.publish_song(uuid, text) from public;
grant execute on function public.publish_song(uuid, text) to authenticated;

comment on function public.publish_song(uuid, text) is
  'Publish a completed song. Owner-only. Mints stable public_id on first publish; reuses slug on re-publish. ADR 0013.';

-- 4. RLS: read-only widening for published songs -----------------------------

drop policy if exists jobs_select_public on public.jobs;
create policy jobs_select_public on public.jobs
  for select to anon, authenticated
  using (
    published_visibility in ('public', 'unlisted')
    and public_id is not null
  );

drop policy if exists song_documents_select_public on public.song_documents;
create policy song_documents_select_public on public.song_documents
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.song_document_id = song_documents.id
        and j.published_visibility in ('public', 'unlisted')
        and j.public_id is not null
    )
  );

drop policy if exists tracks_select_public on public.tracks;
create policy tracks_select_public on public.tracks
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = tracks.job_id
        and j.published_visibility in ('public', 'unlisted')
        and j.public_id is not null
    )
  );

-- Storage: deliberately NOT widened.  Public visitors get a short-lived
-- signed URL minted server-side by /api/p/[publicId]/audio-url using the
-- service-role key.  That keeps the bucket private while still enabling
-- playback from the share page.

-- ======== 0014_lock_down_gen_public_id.sql ========
-- 0014_lock_down_gen_public_id.sql -- close anon access to publish surface
--
-- Two security-advisor lints (0028 + 0029) flagged that
--   - public.gen_public_id() was callable by anon and authenticated
--   - public.publish_song() was callable by anon
-- via PostgREST's `/rest/v1/rpc/<name>` endpoint.
--
-- gen_public_id() is an internal helper of publish_song(). publish_song is
-- SECURITY DEFINER and executes as its owner, so its caller does not need
-- EXECUTE on the helper. We lock gen_public_id() down to service_role only.
--
-- publish_song() needs to stay callable by `authenticated` (that's the M1
-- publish flow). It does an `auth.uid() is null` check inside, so calling
-- it as anon would have raised at runtime, but we close the door explicitly
-- to silence the lint and avoid surprises.

revoke all on function public.gen_public_id() from public, anon, authenticated;
grant execute on function public.gen_public_id() to service_role;

revoke all on function public.publish_song(uuid, text) from anon;
-- (authenticated already has execute from 0013)

-- ======== 0015_quota_completed_only.sql ========
-- 0015_quota_completed_only.sql -- quota counts completed jobs only + concurrent cap (ADR 0014)
--
-- TRIZ Contradiction C14: the current quota counts *every* job ever
-- created this month, including queued/processing/failed. That means a
-- single transient DGX outage (50+ failed jobs) could permanently lock a
-- free-tier user out for the rest of the month, even though no real work
-- happened. At the same time, simply counting `completed` would let a
-- user enqueue a thousand jobs in a single burst, exceed the DGX VRAM
-- budget, and DoS the worker.
--
-- Resolve by separating the two concerns:
--
--   1. Quota (monthly budget, billing): count only `completed` jobs
--      this month. Failed/queued/processing don't burn the user's
--      monthly allowance, matching the user's intuition ("I get 3
--      songs/month").
--
--   2. Concurrency cap (anti-abuse, capacity protection): cap the
--      number of `queued` + `processing` jobs a user can have in
--      flight at once. Free=1, Creator=3, Pro=10. Submitting a 4th
--      job while 3 are in flight raises `concurrent_cap_exceeded`.
--
-- This migration is additive: existing rows are unaffected. We rewrite
-- user_jobs_count_today/month and create_song_job / create_section_regen_job
-- in place.
--
-- ADR 0014 owns the rationale.

-- 1. Quota function: count completed jobs in the current calendar month.
create or replace function public.user_jobs_count_month(p_user_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int
  from public.jobs
  where user_id = p_user_id
    and status = 'completed'
    and finished_at >= date_trunc('month', now() at time zone 'utc');
$$;

-- Keep _today as an alias for backwards compatibility. Same semantics
-- (count completed jobs this calendar month). Other code calls _today.
create or replace function public.user_jobs_count_today(p_user_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select public.user_jobs_count_month(p_user_id);
$$;

-- 2. Concurrent-processing cap: queued + processing jobs in flight.
create or replace function public.user_concurrent_processing_count(p_user_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int
  from public.jobs
  where user_id = p_user_id
    and status in ('queued', 'processing');
$$;

-- 3. Per-tier concurrent cap. Mirrors user_tier_quota shape.
create or replace function public.user_tier_concurrent_cap(p_user_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select case coalesce(u.tier, 'free'::public.tier_enum)
    when 'free'    then 1
    when 'creator' then 3
    when 'pro'     then 10
  end
  from public.users u where u.id = p_user_id;
$$;

revoke all on function public.user_concurrent_processing_count(uuid) from public;
grant execute on function public.user_concurrent_processing_count(uuid)
  to authenticated, service_role;
revoke all on function public.user_tier_concurrent_cap(uuid) from public;
grant execute on function public.user_tier_concurrent_cap(uuid)
  to authenticated, service_role;

-- 4. create_song_job: enforce both quota (completed) + concurrent cap.
create or replace function public.create_song_job(
  p_song_document jsonb,
  p_language public.language_enum,
  p_style_family public.style_family_enum,
  p_target_duration_seconds integer,
  p_priority integer default 0,
  p_attempt_id uuid default null,
  p_trace_id text default null
)
returns table(
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
  v_in_flight integer;
  v_concurrent_cap integer;
  v_used_bytes bigint;
  v_bytes_cap bigint;
  v_estimated_bytes bigint;
  v_doc_id uuid;
  v_job_id uuid;
  v_attempt_id uuid := coalesce(p_attempt_id, extensions.gen_random_uuid());
  v_trace_id text := coalesce(p_trace_id, extensions.gen_random_uuid()::text);
  v_payload jsonb;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_target_duration_seconds not in (30, 60, 90, 180) then
    raise exception 'invalid_target_duration_seconds' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  v_used := public.user_jobs_count_month(v_user_id);
  v_quota := coalesce(public.user_tier_quota(v_user_id), 3);

  if v_used >= v_quota then
    raise exception 'quota_exceeded' using errcode = '22023';
  end if;

  v_in_flight := public.user_concurrent_processing_count(v_user_id);
  v_concurrent_cap := coalesce(public.user_tier_concurrent_cap(v_user_id), 1);

  if v_in_flight >= v_concurrent_cap then
    raise exception 'concurrent_cap_exceeded' using errcode = '22023';
  end if;

  v_estimated_bytes := (p_target_duration_seconds * 25000)::bigint;
  v_used_bytes := public.user_storage_bytes(v_user_id);
  v_bytes_cap  := coalesce(
    public.user_tier_storage_bytes_cap(v_user_id), 524288000);

  if v_used_bytes + v_estimated_bytes > v_bytes_cap then
    raise exception 'storage_quota_exceeded' using errcode = '22023';
  end if;

  insert into public.song_documents (
    user_id, language, style_family, document_json)
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
    'created_at', to_char(now() at time zone 'utc',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'style_family', p_style_family,
    'target_duration_seconds', p_target_duration_seconds,
    'attempt_id', v_attempt_id,
    'attempt_number', 1,
    'trace_id', v_trace_id
  );

  perform public.enqueue_song_generation_job(v_payload);

  return query select v_job_id, v_doc_id,
                      'queued'::public.job_status_enum;
end;
$$;

-- 5. create_section_regen_job: same dual gate. Section regen counts
--    toward both the monthly quota (once completed) and the concurrent cap.
create or replace function public.create_section_regen_job(
  p_parent_job_id uuid,
  p_section_id text,
  p_attempt_id uuid default null,
  p_trace_id text default null
)
returns table(
  job_id uuid,
  parent_job_id uuid,
  section_id text,
  status public.job_status_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_parent record;
  v_used integer;
  v_quota integer;
  v_in_flight integer;
  v_concurrent_cap integer;
  v_doc jsonb;
  v_section_found boolean;
  v_new_job_id uuid;
  v_attempt_id uuid := coalesce(p_attempt_id, extensions.gen_random_uuid());
  v_trace_id text := coalesce(p_trace_id, extensions.gen_random_uuid()::text);
  v_payload jsonb;
  v_section_target integer;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select j.id, j.user_id, j.status, j.song_document_id,
         sd.document_json, sd.language, sd.style_family
    into v_parent
    from public.jobs j
    join public.song_documents sd on sd.id = j.song_document_id
   where j.id = p_parent_job_id;

  if v_parent.id is null or v_parent.user_id <> v_user_id then
    raise exception 'parent_job_not_found' using errcode = '42704';
  end if;
  if v_parent.status <> 'completed' then
    raise exception 'parent_job_not_completed' using errcode = '22023';
  end if;

  v_doc := v_parent.document_json;
  select exists (
    select 1
    from jsonb_array_elements(v_doc -> 'sections') as s
    where s ->> 'id' = p_section_id
  ),
  (
    select (s ->> 'target_seconds')::integer
    from jsonb_array_elements(v_doc -> 'sections') as s
    where s ->> 'id' = p_section_id
    limit 1
  )
  into v_section_found, v_section_target;

  if not v_section_found then
    raise exception 'section_not_in_document' using errcode = '22023';
  end if;

  v_used := public.user_jobs_count_month(v_user_id);
  v_quota := coalesce(public.user_tier_quota(v_user_id), 3);
  if v_used >= v_quota then
    raise exception 'quota_exceeded' using errcode = '22023';
  end if;

  v_in_flight := public.user_concurrent_processing_count(v_user_id);
  v_concurrent_cap := coalesce(
    public.user_tier_concurrent_cap(v_user_id), 1);
  if v_in_flight >= v_concurrent_cap then
    raise exception 'concurrent_cap_exceeded' using errcode = '22023';
  end if;

  insert into public.jobs (
    user_id, song_document_id, status, priority, progress,
    attempts, attempt_id, trace_id, parent_job_id, section_id
  )
  values (
    v_user_id, v_parent.song_document_id, 'queued', 0, 0,
    0, v_attempt_id, v_trace_id, p_parent_job_id, p_section_id
  )
  returning id into v_new_job_id;

  v_payload := jsonb_build_object(
    'job_id', v_new_job_id,
    'parent_job_id', p_parent_job_id,
    'section_id', p_section_id,
    'user_id', v_user_id,
    'song_document_id', v_parent.song_document_id,
    'priority', 'normal',
    'created_at', to_char(now() at time zone 'utc',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'style_family', v_parent.style_family,
    'target_duration_seconds', coalesce(v_section_target, 30),
    'attempt_id', v_attempt_id,
    'attempt_number', 1,
    'trace_id', v_trace_id,
    'is_section_regen', true
  );

  perform public.enqueue_song_generation_job(v_payload);

  return query
    select v_new_job_id, p_parent_job_id, p_section_id,
           'queued'::public.job_status_enum;
end;
$$;

-- ======== 0016_orphan_metrics.sql ========
-- 0016_orphan_metrics.sql — Sprint C bug-b
--
-- The "Audio URL pending..." user-visible bug (v1.1 bug b) happens when
-- a job row ends up status='completed' without a matching `tracks` row,
-- or when a job is left in 'failed' and the user wants to retry. This
-- migration introduces four things:
--
--   1. `jobs.recovered_at` -- audit column populated by the recover RPC
--      and by the orphan-reconciler edge function. Lets us see how often
--      orphan recovery fires.
--
--   2. View `public.orphan_jobs` listing every job that is `completed`
--      but has zero `tracks` children. Used by:
--        - the reconciler edge function (Sprint C-b),
--        - operator queries, and
--        - the recover RPC's check.
--      The view is `security_invoker=on` so it honors caller RLS on
--      jobs/tracks (an authenticated user sees only their own orphans;
--      service_role sees all).
--
--   3. RPC `public.recover_song_job(p_job_id uuid)` -- the atomic
--      "retry me" entrypoint. SECURITY DEFINER + explicit search_path
--      (advisor-clean). Verifies ownership (auth.uid()), verifies the
--      job is recoverable (completed-orphan or failed), resets the
--      jobs row, re-enqueues pgmq. Returns the new attempt_id.
--
--      All-or-nothing inside one transaction. Direct UPDATE on
--      public.jobs is still revoked from `authenticated` (per migration
--      0005), so this RPC is the only path a user can reset their own
--      stuck job. Closes the same "PostgREST bypass" hole that
--      `create_song_job` closes for creation.
--
--   4. Index `tracks_job_id_created_at_idx` -- already used by the
--      app for the "latest track" sort. Idempotent.

alter table public.jobs
  add column if not exists recovered_at timestamptz;

create index if not exists jobs_orphan_idx
  on public.jobs (finished_at)
  where status = 'completed';

create index if not exists tracks_job_id_created_at_idx
  on public.tracks (job_id, created_at desc);

create or replace view public.orphan_jobs
  with (security_invoker = true)
  as
  select
    j.id              as job_id,
    j.user_id,
    j.song_document_id,
    j.status,
    j.attempts,
    j.attempt_id,
    j.finished_at,
    j.recovered_at,
    j.created_at,
    j.error
  from public.jobs j
  left join public.tracks t on t.job_id = j.id
  where j.status = 'completed'
    and t.id is null;

comment on view public.orphan_jobs is
  'Jobs that report status=completed yet have no rendered track row. Surfaced by the orphan-reconciler edge function and the /api/songs/[id]/recover endpoint. Indexed on jobs.finished_at via jobs_orphan_idx for cheap scans.';

grant select on public.orphan_jobs to authenticated;
grant select on public.orphan_jobs to service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'neo_fm_worker') then
    execute 'grant select on public.orphan_jobs to neo_fm_worker';
  end if;
end$$;

-- ---------------------------------------------------------------------
-- public.recover_song_job(p_job_id)
-- ---------------------------------------------------------------------

create or replace function public.recover_song_job(p_job_id uuid)
returns table (job_id uuid, attempt_id uuid, status public.job_status_enum)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller            uuid := auth.uid();
  v_user_id           uuid;
  v_song_document_id  uuid;
  v_status            public.job_status_enum;
  v_track_count       int;
  v_new_attempt_id    uuid := gen_random_uuid();
  v_new_trace_id      uuid := gen_random_uuid();
begin
  if v_caller is null then
    raise exception 'unauthenticated';
  end if;

  select j.user_id, j.song_document_id, j.status
    into v_user_id, v_song_document_id, v_status
    from public.jobs j
   where j.id = p_job_id
   for update;

  if v_user_id is null then
    -- Don't leak existence to non-owners; behave as "not found".
    raise exception 'job_not_found';
  end if;
  if v_user_id <> v_caller then
    raise exception 'job_not_found';
  end if;

  select count(*) into v_track_count
    from public.tracks
   where tracks.job_id = p_job_id;

  -- Recoverable only when:
  --   (a) status='completed' AND no tracks row (the "Audio URL pending"
  --       orphan -- bug b), or
  --   (b) status='failed' (the user wants to retry an explicit failure).
  -- Never recover queued/processing (would race the worker).
  if not (
    (v_status = 'completed'::public.job_status_enum and v_track_count = 0)
    or v_status = 'failed'::public.job_status_enum
  ) then
    raise exception 'not_recoverable: status=%, tracks=%', v_status, v_track_count;
  end if;

  update public.jobs
     set status            = 'queued'::public.job_status_enum,
         attempt_id        = v_new_attempt_id,
         trace_id          = v_new_trace_id::text,
         error             = null,
         progress          = 0,
         started_at        = null,
         finished_at       = null,
         lease_renewed_at  = null,
         recovered_at      = now()
   where id = p_job_id;

  -- Re-enqueue. The worker reads pgmq and trusts the queue payload's
  -- user_id/song_document_id (claim_job_processing binds the claim to
  -- both columns, ADR 0008).
  perform pgmq.send(
    'q_song_jobs',
    jsonb_build_object(
      'job_id', p_job_id::text,
      'user_id', v_caller::text,
      'song_document_id', v_song_document_id::text,
      'attempt_id', v_new_attempt_id::text,
      'trace_id', v_new_trace_id::text,
      'reason', 'recover'
    )
  );

  return query
    select p_job_id, v_new_attempt_id, 'queued'::public.job_status_enum;
end;
$$;

comment on function public.recover_song_job(uuid) is
  'Atomically re-enqueues a stuck job (completed-without-tracks orphan, or failed). SECURITY DEFINER under explicit search_path. Only the job owner may invoke; ownership is checked against auth.uid() under FOR UPDATE.';

revoke execute on function public.recover_song_job(uuid) from public, anon;
grant execute on function public.recover_song_job(uuid) to authenticated;
grant execute on function public.recover_song_job(uuid) to service_role;

-- ======== 0017_song_title.sql ========
-- 0017_song_title.sql -- denormalize the song title (Sprint C bug-c)
--
-- Bug report (user, May 2026): the library and detail pages were showing
-- truncated UUID-style strings instead of a human-readable name. Until now
-- the only "name" a song had was the row id, because we never asked the user
-- for a title at create time.
--
-- We persist title in two places:
--   1. public.song_documents.title  -- canonical, owned by the document
--   2. SongDocument.title (JSON)    -- carried by the Zod schema for symmetry
--
-- The JSON copy is what create_song_job picks off and writes to column #1.
-- A check constraint mirrors the SONG_TITLE_MAX_CHARS = 120 from
-- packages/song-doc.
--
-- Backfill strategy: every existing row gets a synthesized title of
-- "<Style> in <Language> -- <yyyy-mm-dd>" so /library never has to show a
-- UUID even for songs created before this migration. The web layer also
-- has a fallback so the rollout order is forgiving.

alter table public.song_documents
  add column if not exists title text;

alter table public.song_documents
  drop constraint if exists song_documents_title_length_ck;
alter table public.song_documents
  add constraint song_documents_title_length_ck
  check (title is null or char_length(title) between 1 and 120);

-- Backfill (idempotent; only touches NULL rows)
update public.song_documents
   set title = initcap(replace(style_family::text, '-', ' ')) || ' in '
             || case language::text
                  when 'en' then 'English'
                  when 'hi' then 'Hindi'
                  when 'kn' then 'Kannada'
                  else language::text
                end
             || ' -- ' || to_char(created_at at time zone 'utc', 'YYYY-MM-DD')
 where title is null;

comment on column public.song_documents.title is
  'Human-readable song name (<=120 chars). Sourced from SongDocument.title at create time; backfilled for pre-Sprint-C rows. The detail/library/share/OG card all render this verbatim.';

-- Patch create_song_job so a `title` inside the supplied document JSON
-- lands in the new column. Trim, cap at 120, and reject blanks; the web
-- layer also validates, but we want defence-in-depth so a PostgREST
-- bypass (no longer possible after migration 0008, but in principle)
-- still produces a usable row.
create or replace function public.create_song_job(
  p_song_document jsonb,
  p_language public.language_enum,
  p_style_family public.style_family_enum,
  p_target_duration_seconds integer,
  p_priority integer default 0,
  p_attempt_id uuid default null,
  p_trace_id text default null
)
returns table(
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
  v_in_flight integer;
  v_concurrent_cap integer;
  v_used_bytes bigint;
  v_bytes_cap bigint;
  v_estimated_bytes bigint;
  v_doc_id uuid;
  v_job_id uuid;
  v_attempt_id uuid := coalesce(p_attempt_id, extensions.gen_random_uuid());
  v_trace_id text := coalesce(p_trace_id, extensions.gen_random_uuid()::text);
  v_payload jsonb;
  v_title text;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_target_duration_seconds not in (30, 60, 90, 180) then
    raise exception 'invalid_target_duration_seconds' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(extensions.hashtextextended(v_user_id::text, 0));

  v_used := public.user_jobs_count_month(v_user_id);
  v_quota := coalesce(public.user_tier_quota(v_user_id), 3);

  if v_used >= v_quota then
    raise exception 'quota_exceeded' using errcode = '22023';
  end if;

  v_in_flight := public.user_concurrent_processing_count(v_user_id);
  v_concurrent_cap := coalesce(public.user_tier_concurrent_cap(v_user_id), 1);

  if v_in_flight >= v_concurrent_cap then
    raise exception 'concurrent_cap_exceeded' using errcode = '22023';
  end if;

  v_estimated_bytes := (p_target_duration_seconds * 25000)::bigint;
  v_used_bytes := public.user_storage_bytes(v_user_id);
  v_bytes_cap  := coalesce(
    public.user_tier_storage_bytes_cap(v_user_id), 524288000);

  if v_used_bytes + v_estimated_bytes > v_bytes_cap then
    raise exception 'storage_quota_exceeded' using errcode = '22023';
  end if;

  v_title := nullif(btrim(coalesce(p_song_document->>'title', '')), '');
  if v_title is not null and char_length(v_title) > 120 then
    v_title := left(v_title, 120);
  end if;
  if v_title is null then
    v_title := initcap(replace(p_style_family::text, '-', ' ')) || ' in '
             || case p_language::text
                  when 'en' then 'English'
                  when 'hi' then 'Hindi'
                  when 'kn' then 'Kannada'
                  else p_language::text
                end
             || ' -- ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  end if;

  insert into public.song_documents (
    user_id, language, style_family, document_json, title)
  values (v_user_id, p_language, p_style_family, p_song_document, v_title)
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
    'created_at', to_char(now() at time zone 'utc',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'style_family', p_style_family,
    'target_duration_seconds', p_target_duration_seconds,
    'attempt_id', v_attempt_id,
    'attempt_number', 1,
    'trace_id', v_trace_id
  );

  perform public.enqueue_song_generation_job(v_payload);

  return query select v_job_id, v_doc_id,
                      'queued'::public.job_status_enum;
end;
$$;

-- ======== 0018_vocal_telemetry.sql ========
-- 0018_vocal_telemetry.sql -- vocal model + eval score telemetry (Sprint D)
--
-- ADR 0020 splits vocal synthesis across two real backends + a fake.
-- Without telemetry the bug report "the singing sounds wrong" has no
-- handles. We add three nullable columns to public.tracks:
--
--   - vocal_backend       text  -- 'svara' | 'parler' | 'fake' | 'mixed'
--   - vocal_model_version text  -- e.g. 'kenpath/svara-tts-v1@abc1234'
--   - vocal_eval_score    float -- overall_score from app.eval.evaluate_wav
--
-- The worker fills these in alongside the storage upload. The
-- support page (Sprint F) will surface the score so users can flag
-- low-quality renders for retry, and the orphan-reconciler can use
-- vocal_eval_score < threshold as a signal to mark a job 'failed'
-- and re-enqueue instead of leaving it in 'completed'.

alter table public.tracks
  add column if not exists vocal_backend text;

alter table public.tracks
  add column if not exists vocal_model_version text;

alter table public.tracks
  add column if not exists vocal_eval_score double precision;

alter table public.tracks
  drop constraint if exists tracks_vocal_eval_score_range_ck;
alter table public.tracks
  add constraint tracks_vocal_eval_score_range_ck
  check (vocal_eval_score is null or (vocal_eval_score >= 0 and vocal_eval_score <= 1));

comment on column public.tracks.vocal_backend is
  'Which vocal-synth backend produced this stem: svara | parler | fake | mixed (set by RoutingVocalModel).';
comment on column public.tracks.vocal_eval_score is
  '0..1 quality signal from app.eval.evaluate_wav. NULL on legacy rows. Low scores feed the reconciler''s retry decision.';

-- Make the new fields visible to the metrics views Sprint J builds.
create or replace view public.recent_vocal_quality as
  select
    t.created_at,
    t.job_id,
    j.user_id,
    t.vocal_backend,
    t.vocal_model_version,
    t.vocal_eval_score,
    sd.language,
    sd.style_family
  from public.tracks t
  join public.jobs j on j.id = t.job_id
  left join public.song_documents sd on sd.id = j.song_document_id
  where t.vocal_eval_score is not null
  order by t.created_at desc
  limit 1000;

comment on view public.recent_vocal_quality is
  'Most recent 1000 rendered tracks with vocal eval scores attached. Powers the Sprint J Grafana panel.';

grant select on public.recent_vocal_quality to service_role;

-- ======== 0019_pricing_waitlist.sql ========
-- 0019_pricing_waitlist.sql -- waitlist for paid tier CTAs (Sprint E)
--
-- v1.1 ships /pricing with three tiers but only Free is wired to
-- billing (it's just the existing quota). Creator and Pro carry a
-- "Join the waitlist" CTA that drops the visitor's email here.
-- A real Stripe wiring lands in v1.2 -- this table feeds the
-- launch announcement list in the meantime.
--
-- Anonymous insert is allowed (the visitor may not be signed in)
-- but goes through an RPC so we can rate-limit per-IP from the
-- middleware layer (Sprint I).

create table if not exists public.waitlist (
  id uuid primary key default extensions.gen_random_uuid(),
  email text not null,
  tier text not null check (tier in ('creator','pro','team')),
  source text not null default 'pricing',
  user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_email_tier_uniq
  on public.waitlist (lower(email), tier);

comment on table public.waitlist is
  'Email captures from /pricing waitlist CTAs. Drained into the launch announcement list. Never used for transactional email.';

alter table public.waitlist enable row level security;

create policy waitlist_service_only_select on public.waitlist
  for select to service_role using (true);

create or replace function public.join_waitlist(
  p_email text,
  p_tier text,
  p_source text default 'pricing'
)
returns table (joined boolean, already_on_list boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid uuid := auth.uid();
begin
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_tier not in ('creator','pro','team') then
    raise exception 'invalid_tier' using errcode = '22023';
  end if;
  insert into public.waitlist (email, tier, source, user_id)
    values (v_email, p_tier, coalesce(p_source, 'pricing'), v_uid)
    on conflict (lower(email), tier) do nothing;
  if found then
    return query select true, false;
  else
    return query select false, true;
  end if;
end;
$$;

revoke execute on function public.join_waitlist(text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text)
  to anon, authenticated, service_role;

-- ======== 0021_feedback.sql ========
-- 0021_feedback.sql -- user feedback inbox (Sprint E)
--
-- The /feedback page captures: subject, body, optional referrer (which
-- URL the user clicked from), and the authenticated user_id if any.
-- Anonymous feedback is allowed -- a lot of low-friction bug reports
-- come from people who never bothered to sign up.
--
-- Inserts go through public.submit_feedback(); reads are
-- service_role-only (we never expose feedback to other users).

create table if not exists public.feedback (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 5000),
  referrer text,
  status text not null default 'new' check (status in ('new','triaged','resolved','spam')),
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_at_idx
  on public.feedback (created_at desc);

comment on table public.feedback is
  'Free-form user-submitted feedback. Anonymous allowed. Service-role-only read.';

alter table public.feedback enable row level security;

create policy feedback_service_only_select on public.feedback
  for select to service_role using (true);

create or replace function public.submit_feedback(
  p_subject text,
  p_body text,
  p_referrer text default null
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_subject text := btrim(coalesce(p_subject, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_subject = '' then
    raise exception 'empty_subject' using errcode = '22023';
  end if;
  if char_length(v_subject) > 200 then
    v_subject := left(v_subject, 200);
  end if;
  if v_body = '' then
    raise exception 'empty_body' using errcode = '22023';
  end if;
  if char_length(v_body) > 5000 then
    v_body := left(v_body, 5000);
  end if;
  insert into public.feedback (user_id, subject, body, referrer)
  values (v_uid, v_subject, v_body, left(coalesce(p_referrer, ''), 500))
  returning public.feedback.id into v_id;
  return query select v_id;
end;
$$;

revoke execute on function public.submit_feedback(text, text, text) from public;
grant execute on function public.submit_feedback(text, text, text)
  to anon, authenticated, service_role;

-- ======== 0022_library_upgrades.sql ========
-- 0022_library_upgrades.sql -- favorites + library sort indexes (Sprint F)
--
-- Adds `is_favorite` on jobs so the user can star a song from the
-- library, and indexes that make the common filter / sort
-- combinations fast even at 10k+ songs per user.
--
-- Rename and delete don't need new columns: rename mutates the
-- existing `song_documents.title`, and delete piggybacks on the
-- existing `jobs` -> cascade.

alter table public.jobs
  add column if not exists is_favorite boolean not null default false;

comment on column public.jobs.is_favorite is
  'User-toggled favorite flag for /library. Sortable, filterable, RLS-scoped.';

-- Indexes for the common library queries:
--   * "all my songs newest first"  -> (user_id, created_at desc)  (already exists)
--   * "my favorites newest first"  -> partial index on is_favorite=true
--   * sort by oldest, by duration  -> handled at app level (LIMIT 50 is small)

create index if not exists jobs_user_favorites_idx
  on public.jobs (user_id, created_at desc)
  where is_favorite = true;

-- For filter dropdowns (style, language) we read from song_documents,
-- which is already indexed by (user_id, style_family) implicitly via
-- the user_id FK and the small per-user fanout.

-- public.toggle_favorite(p_job_id) -- one round-trip flip. RLS on
-- the underlying table already enforces ownership, but we wrap it
-- in a SECURITY INVOKER function so the API call is concise.
create or replace function public.toggle_favorite(p_job_id uuid)
returns table (id uuid, is_favorite boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new boolean;
begin
  update public.jobs
     set is_favorite = not is_favorite
   where public.jobs.id = p_job_id
   returning public.jobs.is_favorite into v_new;
  if v_new is null then
    raise exception 'job_not_found_or_forbidden' using errcode = '42501';
  end if;
  return query select p_job_id, v_new;
end;
$$;

revoke execute on function public.toggle_favorite(uuid) from public;
grant execute on function public.toggle_favorite(uuid) to authenticated, service_role;

-- public.rename_song(p_job_id, p_title) -- updates song_documents.title.
-- We go through a function so we can bound the length here too and
-- not duplicate the 120-char rule across the codebase.
create or replace function public.rename_song(p_job_id uuid, p_title text)
returns table (id uuid, title text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_doc_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_title = '' then
    raise exception 'empty_title' using errcode = '22023';
  end if;
  if char_length(v_title) > 120 then
    v_title := left(v_title, 120);
  end if;
  select song_document_id into v_doc_id
    from public.jobs
   where public.jobs.id = p_job_id;
  if v_doc_id is null then
    raise exception 'job_not_found_or_forbidden' using errcode = '42501';
  end if;
  update public.song_documents
     set title = v_title
   where public.song_documents.id = v_doc_id;
  return query select p_job_id, v_title;
end;
$$;

revoke execute on function public.rename_song(uuid, text) from public;
grant execute on function public.rename_song(uuid, text) to authenticated, service_role;

-- RLS: allow a user to delete their own jobs. The Postgres FK cascade
-- on tracks / public_songs / song_documents takes care of the related
-- rows. Storage objects are GC'd by a nightly cron, not this transaction.
drop policy if exists jobs_delete_own on public.jobs;
create policy jobs_delete_own on public.jobs
  for delete to authenticated
  using (user_id = auth.uid());

-- ======== 0023_user_handles.sql ========
-- 0023_user_handles.sql -- public handles for profile pages (Sprint G)
--
-- Each user picks a global, URL-safe `handle` (3-30 chars, [a-z0-9_],
-- case-insensitive unique). `/u/[handle]` resolves to the public
-- profile, and the UserMenu shows `@handle` once set. Handle is
-- optional at signup; users land on `/onboarding/handle` after
-- their first sign-in until they pick one.
--
-- We don't migrate existing rows; the menu shows "Pick a handle"
-- until the user fills the field.

alter table public.users
  add column if not exists handle text;

-- Case-insensitive uniqueness. Citext would be cleaner but we don't
-- need the extension; the index does the same job.
create unique index if not exists users_handle_lower_uniq
  on public.users (lower(handle))
  where handle is not null;

-- Format check: 3-30 chars, lowercase ASCII letters/digits/underscore.
-- We do the check in a trigger rather than a column check so the
-- error message is friendlier to the API caller and we can return
-- distinct errors (`too_short` vs `bad_chars`).
create or replace function public.validate_handle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.handle is null then
    return new;
  end if;
  new.handle := lower(btrim(new.handle));
  if char_length(new.handle) < 3 then
    raise exception 'handle_too_short' using errcode = '22023';
  end if;
  if char_length(new.handle) > 30 then
    raise exception 'handle_too_long' using errcode = '22023';
  end if;
  if new.handle !~ '^[a-z0-9_]+$' then
    raise exception 'handle_bad_chars' using errcode = '22023';
  end if;
  if new.handle in ('admin','root','support','help','about','api','www','neo','neofm','neo-fm','songs','library','discover','pricing','feedback','account','signin','signup','sign-in','sign-up','auth','s','u','public') then
    raise exception 'handle_reserved' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists users_validate_handle on public.users;
create trigger users_validate_handle
  before insert or update of handle on public.users
  for each row execute function public.validate_handle();

comment on column public.users.handle is
  'Lowercase URL-safe handle (3-30 chars, [a-z0-9_]). Globally unique. Picked at /onboarding/handle.';

-- public.claim_handle(p_handle) -- typed errors, RLS-respecting via
-- security invoker. Used by the onboarding flow.
create or replace function public.claim_handle(p_handle text)
returns table (handle text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text := lower(btrim(coalesce(p_handle, '')));
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  update public.users
     set handle = v_handle
   where public.users.id = v_uid;
  return query select v_handle;
exception
  when unique_violation then
    raise exception 'handle_taken' using errcode = '23505';
end;
$$;

revoke execute on function public.claim_handle(text) from public;
grant execute on function public.claim_handle(text) to authenticated, service_role;

-- RLS: allow any signed-in or anon user to SELECT (id, handle) of a
-- public profile. Email and tier remain private. We narrow the
-- exposed columns via a view.
create or replace view public.public_profiles as
  select id, handle, created_at
    from public.users
   where handle is not null;

comment on view public.public_profiles is
  'Anonymous-readable subset of public.users. id + handle + member-since only.';

grant select on public.public_profiles to anon, authenticated;

-- ======== 0024_social.sql ========
-- 0024_social.sql -- likes, follows, reports (Sprint G)
--
-- Light social layer on top of the share surface (ADR 0013). The
-- design is consciously minimal:
--   - likes: (user_id, job_id) unique. Anonymous likes are not
--     supported in v1.1; you have to be signed in.
--   - follows: (follower_id, followee_id) unique. Self-follow blocked.
--   - reports: free-form report-flag on a public song. Service-role
--     reads only.

create table if not exists public.song_likes (
  user_id uuid not null references public.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create index if not exists song_likes_job_idx
  on public.song_likes (job_id);

comment on table public.song_likes is
  'User -> published song likes. (user_id, job_id) is the natural key.';

alter table public.song_likes enable row level security;

-- Anyone can SELECT to count likes on a public song. Only the user
-- themselves can INSERT/DELETE their like row.
drop policy if exists song_likes_select_all on public.song_likes;
create policy song_likes_select_all on public.song_likes
  for select to anon, authenticated using (true);

drop policy if exists song_likes_insert_own on public.song_likes;
create policy song_likes_insert_own on public.song_likes
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists song_likes_delete_own on public.song_likes;
create policy song_likes_delete_own on public.song_likes
  for delete to authenticated
  using (user_id = auth.uid());

-- Followers ----------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.users(id) on delete cascade,
  followee_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx
  on public.follows (followee_id);

comment on table public.follows is
  'User -> user follow graph. Used for follower counts and (future) feed scoping.';

alter table public.follows enable row level security;

drop policy if exists follows_select_all on public.follows;
create policy follows_select_all on public.follows
  for select to anon, authenticated using (true);

drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows
  for insert to authenticated
  with check (follower_id = auth.uid());

drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows
  for delete to authenticated
  using (follower_id = auth.uid());

-- Reports ------------------------------------------------------------------
create table if not exists public.song_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  reporter_id uuid references public.users(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists song_reports_job_idx
  on public.song_reports (job_id, created_at desc);

comment on table public.song_reports is
  'Abuse reports against published songs. Service-role read; only insert from end users.';

alter table public.song_reports enable row level security;

drop policy if exists song_reports_select_service on public.song_reports;
create policy song_reports_select_service on public.song_reports
  for select to service_role using (true);

drop policy if exists song_reports_insert_auth on public.song_reports;
create policy song_reports_insert_auth on public.song_reports
  for insert to anon, authenticated
  with check (true);

-- Helpers ------------------------------------------------------------------

-- Atomic like / unlike. Returns the new state and updated count.
create or replace function public.toggle_like(p_job_id uuid)
returns table (is_liked boolean, like_count bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existed integer;
  v_count bigint;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  delete from public.song_likes
   where user_id = v_uid and job_id = p_job_id;
  get diagnostics v_existed = row_count;
  if v_existed = 0 then
    insert into public.song_likes (user_id, job_id)
      values (v_uid, p_job_id)
      on conflict do nothing;
  end if;
  select count(*) into v_count
    from public.song_likes where job_id = p_job_id;
  return query select v_existed = 0, v_count;
end;
$$;

revoke execute on function public.toggle_like(uuid) from public;
grant execute on function public.toggle_like(uuid) to authenticated, service_role;

-- Toggle follow. Same shape as toggle_like; returns is_following + count.
create or replace function public.toggle_follow(p_followee uuid)
returns table (is_following boolean, follower_count bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existed integer;
  v_count bigint;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if v_uid = p_followee then
    raise exception 'cannot_follow_self' using errcode = '22023';
  end if;
  delete from public.follows
   where follower_id = v_uid and followee_id = p_followee;
  get diagnostics v_existed = row_count;
  if v_existed = 0 then
    insert into public.follows (follower_id, followee_id)
      values (v_uid, p_followee)
      on conflict do nothing;
  end if;
  select count(*) into v_count
    from public.follows where followee_id = p_followee;
  return query select v_existed = 0, v_count;
end;
$$;

revoke execute on function public.toggle_follow(uuid) from public;
grant execute on function public.toggle_follow(uuid) to authenticated, service_role;

-- Report a song. Anonymous-allowed (reporter_id is nullable).
create or replace function public.report_song(p_job_id uuid, p_reason text)
returns table (id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  if v_reason = '' then
    raise exception 'empty_reason' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    v_reason := left(v_reason, 500);
  end if;
  insert into public.song_reports (job_id, reporter_id, reason)
    values (p_job_id, auth.uid(), v_reason)
    returning song_reports.id into v_id;
  return query select v_id;
end;
$$;

revoke execute on function public.report_song(uuid, text) from public;
grant execute on function public.report_song(uuid, text)
  to anon, authenticated, service_role;

-- ======== 0025_stems.sql ========
-- 0025_stems.sql -- per-job stem references (Sprint H wow #2)
--
-- The mixer in `services/dgx-worker` currently writes a single
-- mastered WAV. After v1.1 it will additionally persist each
-- stem (vocal, melody, percussion, master) into the `stems`
-- subfolder of the `tracks` bucket. This migration declares the
-- table the API expects so the UI can be built independently of
-- the worker change.
--
-- Until the worker starts populating rows, the stems list is
-- empty for all jobs and the UI shows "Stems aren't ready yet
-- for this song" -- not an error.

create table if not exists public.track_stems (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind text not null check (kind in ('vocal','melody','percussion','master')),
  url text not null,
  bytes bigint,
  format public.track_format_enum not null default 'wav',
  created_at timestamptz not null default now(),
  unique (job_id, kind)
);

create index if not exists track_stems_job_idx on public.track_stems (job_id);

comment on table public.track_stems is
  'Per-stem audio for a job. (job_id, kind) is the natural key. Worker upserts on completion.';

alter table public.track_stems enable row level security;

-- Owner-only read for private tracks; widen for published songs
-- mirroring the tracks_select_public policy.
drop policy if exists track_stems_select_own on public.track_stems;
create policy track_stems_select_own on public.track_stems
  for select to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = track_stems.job_id and j.user_id = auth.uid()
    )
  );

drop policy if exists track_stems_select_public on public.track_stems;
create policy track_stems_select_public on public.track_stems
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = track_stems.job_id
        and j.published_visibility in ('public','unlisted')
        and j.public_id is not null
    )
  );

-- Worker (BYPASSRLS) inserts; users never write directly.

-- ======== 0026_cover_art.sql ========
-- 0026_cover_art.sql -- AI-generated cover art per song (Sprint H wow #3)
--
-- A separate table (rather than a column on jobs) so we can have
-- multiple cover-art generations per song -- the user re-rolls
-- until they like one. The current cover art for a song is the
-- newest row with `is_current = true`.
--
-- Image storage lives in the `cover-art` bucket, which must be
-- created out-of-band in the Supabase dashboard. Bucket is private;
-- the public song page mints a short-lived signed URL just like
-- audio playback.

create table if not exists public.cover_art (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  prompt text not null check (char_length(prompt) <= 2000),
  url text not null,
  model_version text,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists cover_art_job_current_idx
  on public.cover_art (job_id) where is_current;

comment on table public.cover_art is
  'AI-generated cover art for a song. Multiple rolls per song; is_current points at the active pick.';

alter table public.cover_art enable row level security;

drop policy if exists cover_art_select_own on public.cover_art;
create policy cover_art_select_own on public.cover_art
  for select to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = cover_art.job_id and j.user_id = auth.uid()
    )
  );

drop policy if exists cover_art_select_public on public.cover_art;
create policy cover_art_select_public on public.cover_art
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = cover_art.job_id
        and j.published_visibility in ('public','unlisted')
        and j.public_id is not null
    )
  );

-- Insert only via service-role (the cover-art-generator edge function).

-- ======== 0027_security_advisors.sql ========
-- 0027_security_advisors.sql -- Sprint I, ADR 0021
--
-- Cleans up the Supabase security advisor findings that landed
-- during Sprints D and G:
--
--   1. `public.recent_vocal_quality` (0018) and `public.public_profiles`
--      (0023) were created as SECURITY DEFINER views, which lets any
--      caller bypass the underlying tables' RLS. Recreate them as
--      SECURITY INVOKER -- both views are intentionally readable, but
--      they should still honour RLS on the rows they expose.
--
--   2. `public.song_reports.song_reports_insert_auth` was `WITH CHECK
--      (true)` -- effectively no-RLS for inserts. Tighten it to:
--
--          - anon may insert iff reporter_id is null
--          - authenticated may insert iff reporter_id = auth.uid()
--
--      That blocks a logged-in user from impersonating a different
--      reporter, and blocks anon from forging a reporter_id.
--
--   3. The handful of `SECURITY DEFINER` functions flagged as callable
--      by `anon`/`authenticated` are intentional: they are the only
--      way the user can mutate the corresponding table (e.g.
--      create_song_job is the *only* way to insert into jobs because
--      direct INSERT is revoked from `authenticated`). We add explicit
--      comments to record that decision so future advisor sweeps
--      don't relitigate it. The leaked-password protection is enabled
--      out-of-band via the Supabase auth settings (see
--      docs/SECURITY.md).
--
-- ADR 0021 owns the long-form rationale.

-- 1. recreate views as SECURITY INVOKER ----------------------------------

drop view if exists public.recent_vocal_quality;
create view public.recent_vocal_quality
  with (security_invoker = true)
  as
  select
    t.created_at,
    j.user_id,
    j.id              as job_id,
    sd.style_family,
    sd.language,
    t.vocal_backend,
    t.vocal_model_version,
    t.vocal_eval_score
  from public.tracks t
  join public.jobs j on j.id = t.job_id
  left join public.song_documents sd on sd.id = j.song_document_id
  where t.vocal_eval_score is not null
  order by t.created_at desc
  limit 500;

comment on view public.recent_vocal_quality is
  'Per-track vocal-synth telemetry. SECURITY INVOKER + RLS gates the rows by job ownership.';

drop view if exists public.public_profiles;
create view public.public_profiles
  with (security_invoker = true)
  as
  select id, handle, created_at
    from public.users
   where handle is not null;

comment on view public.public_profiles is
  'Anonymous-readable subset of public.users. SECURITY INVOKER; the underlying users table has a SELECT policy that exposes (id, handle, created_at) to anon, authenticated when handle is not null.';

grant select on public.public_profiles to anon, authenticated;
grant select on public.recent_vocal_quality to authenticated, service_role;

-- Make sure public.users has a SELECT policy that lets anon read the
-- handle+id+created_at slice. Existing policies likely already cover
-- this for `authenticated` only; widen for `anon` without exposing
-- email / tier (those are still gated by the column-level grants /
-- existing policies).
drop policy if exists users_select_public_handle on public.users;
create policy users_select_public_handle on public.users
  for select to anon, authenticated
  using (handle is not null);

-- 2. tighten song_reports_insert_auth ------------------------------------

drop policy if exists song_reports_insert_auth on public.song_reports;

create policy song_reports_insert_anon on public.song_reports
  for insert to anon
  with check (reporter_id is null);

create policy song_reports_insert_authn on public.song_reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

-- 3. annotate intentional SECURITY DEFINER callable functions -------------

comment on function public.create_song_job(jsonb, public.language_enum, public.style_family_enum, integer, integer, uuid, text) is
  'SECURITY DEFINER -- the only path that can insert into public.jobs (direct INSERT is revoked from authenticated). Quota + storage + advisory lock all live inside. ADR 0008 / 0021.';

comment on function public.publish_song(uuid, text) is
  'SECURITY DEFINER -- mints public_id and toggles published_visibility. Caller checked against auth.uid() inside. ADR 0013 / 0021.';

comment on function public.submit_feedback(text, text, text) is
  'SECURITY DEFINER -- anonymous feedback is allowed (RLS would otherwise reject) and the function trims/bounds input. ADR 0021.';

comment on function public.join_waitlist(text, text, text) is
  'SECURITY DEFINER -- anon must be able to write a waitlist row (RLS on the table is service-role-read-only). Function deduplicates per (lower(email), tier). ADR 0021.';

comment on function public.validate_handle() is
  'SECURITY DEFINER trigger function. Runs at INSERT/UPDATE OF handle on public.users. Pure validation; no privileged access. ADR 0021.';

-- validate_handle is only invoked from the BEFORE trigger on public.users.
-- It must not be callable directly via the REST RPC bridge -- revoke EXECUTE
-- from the anon and authenticated roles so it stops appearing in the
-- security advisor.
revoke execute on function public.validate_handle() from anon, authenticated;

-- ======== 0028_create_song_job_hashtext_fix.sql ========
-- 0028_create_song_job_hashtext_fix.sql -- unblock song creation (v1.2 bug 1)
--
-- Bug report (production, May 2026):
--   POST /api/songs failed with:
--     "function extensions.hashtextextended(text, integer) does not exist"
--
-- Migration 0017 redefined create_song_job with `set search_path = ''` and
-- prefixed the advisory-lock hash with `extensions.`. `hashtextextended` is
-- a pg_catalog builtin, not part of pgcrypto, so the qualified call fails.
-- Earlier definitions (0008, 0009, 0012, 0015) correctly used the unqualified
-- form; pg_catalog is always implicitly on the search_path. We re-qualify with
-- pg_catalog to keep the explicit search_path discipline while resolving to
-- the correct function.
--
-- The function body below is byte-for-byte identical to migration 0017 with
-- two changes:
--   1. line `pg_advisory_xact_lock` -> qualified `pg_catalog.hashtextextended`
--   2. comment block above the function describing this hotfix
--
-- `create or replace function` keeps existing grants and RLS intact.

create or replace function public.create_song_job(
  p_song_document jsonb,
  p_language public.language_enum,
  p_style_family public.style_family_enum,
  p_target_duration_seconds integer,
  p_priority integer default 0,
  p_attempt_id uuid default null,
  p_trace_id text default null
)
returns table(
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
  v_in_flight integer;
  v_concurrent_cap integer;
  v_used_bytes bigint;
  v_bytes_cap bigint;
  v_estimated_bytes bigint;
  v_doc_id uuid;
  v_job_id uuid;
  v_attempt_id uuid := coalesce(p_attempt_id, extensions.gen_random_uuid());
  v_trace_id text := coalesce(p_trace_id, extensions.gen_random_uuid()::text);
  v_payload jsonb;
  v_title text;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_target_duration_seconds not in (30, 60, 90, 180) then
    raise exception 'invalid_target_duration_seconds' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0));

  v_used := public.user_jobs_count_month(v_user_id);
  v_quota := coalesce(public.user_tier_quota(v_user_id), 3);

  if v_used >= v_quota then
    raise exception 'quota_exceeded' using errcode = '22023';
  end if;

  v_in_flight := public.user_concurrent_processing_count(v_user_id);
  v_concurrent_cap := coalesce(public.user_tier_concurrent_cap(v_user_id), 1);

  if v_in_flight >= v_concurrent_cap then
    raise exception 'concurrent_cap_exceeded' using errcode = '22023';
  end if;

  v_estimated_bytes := (p_target_duration_seconds * 25000)::bigint;
  v_used_bytes := public.user_storage_bytes(v_user_id);
  v_bytes_cap  := coalesce(
    public.user_tier_storage_bytes_cap(v_user_id), 524288000);

  if v_used_bytes + v_estimated_bytes > v_bytes_cap then
    raise exception 'storage_quota_exceeded' using errcode = '22023';
  end if;

  v_title := nullif(btrim(coalesce(p_song_document->>'title', '')), '');
  if v_title is not null and char_length(v_title) > 120 then
    v_title := left(v_title, 120);
  end if;
  if v_title is null then
    v_title := initcap(replace(p_style_family::text, '-', ' ')) || ' in '
             || case p_language::text
                  when 'en' then 'English'
                  when 'hi' then 'Hindi'
                  when 'kn' then 'Kannada'
                  else p_language::text
                end
             || ' -- ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  end if;

  insert into public.song_documents (
    user_id, language, style_family, document_json, title)
  values (v_user_id, p_language, p_style_family, p_song_document, v_title)
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
    'created_at', to_char(now() at time zone 'utc',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'style_family', p_style_family,
    'target_duration_seconds', p_target_duration_seconds,
    'attempt_id', v_attempt_id,
    'attempt_number', 1,
    'trace_id', v_trace_id
  );

  perform public.enqueue_song_generation_job(v_payload);

  return query select v_job_id, v_doc_id,
                      'queued'::public.job_status_enum;
end;
$$;

comment on function public.create_song_job(
  jsonb, public.language_enum, public.style_family_enum,
  integer, integer, uuid, text
) is
  'Create a song generation job. Per-user advisory lock + monthly quota + concurrent cap + storage check. Hotfixed in v1.2 (migration 0028) to call pg_catalog.hashtextextended explicitly under set search_path = '''' .';

-- ======== 0029_notify_job_complete_webhook.sql ========
-- 0029_notify_job_complete_webhook.sql -- wire job-complete notification
--
-- Creates a Postgres trigger on public.jobs that POSTs to the
-- `notify-job-complete` Edge Function when a row transitions to
-- status = 'completed'. The function then looks up the user's email +
-- song title and sends a Resend transactional email.
--
-- Why a trigger instead of Supabase Dashboard "Database Webhooks"?
--   - Reproducibility. Webhook config in the dashboard is invisible to git;
--     a migration is auditable and revertible.
--   - The trigger reads the shared secret from supabase_vault.decrypted_secrets
--     so the secret never lives in source code or migration history.
--
-- Pre-requisites (set by this migration):
--   - pg_net extension (Async HTTP for triggers).
--   - vault secret named 'neo_fm_webhook_secret' (populated out-of-band via
--     execute_sql; never committed to git).
--
-- Idempotent: trigger and helper function are created via `or replace`.

create extension if not exists pg_net with schema extensions;

-- ----------------------------------------------------------------------------
-- 1. Helper: fetch the shared webhook secret from supabase_vault.
--
-- security definer + search_path = '' so the function can read the vault
-- on behalf of the trigger's authenticated role. The secret name is
-- inserted out-of-band; if it is missing the trigger short-circuits to a
-- no-op (the email simply doesn't fire) so a fresh dev project doesn't
-- break inserts.
-- ----------------------------------------------------------------------------
create or replace function public.neo_fm_webhook_secret()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select decrypted_secret from vault.decrypted_secrets
   where name = 'neo_fm_webhook_secret' limit 1;
$$;

revoke all on function public.neo_fm_webhook_secret() from public;
revoke all on function public.neo_fm_webhook_secret() from anon, authenticated;
grant execute on function public.neo_fm_webhook_secret() to service_role;

comment on function public.neo_fm_webhook_secret() is
  'Returns the shared secret used to authenticate trigger calls to the notify-job-complete Edge Function. Service role only. Body reads supabase_vault.decrypted_secrets.';

-- ----------------------------------------------------------------------------
-- 2. Trigger function: POST to the Edge Function when status flips to
--    completed. Uses pg_net so the HTTP call is async and the transaction
--    is not blocked on the response.
-- ----------------------------------------------------------------------------
create or replace function public.tg_notify_job_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := public.neo_fm_webhook_secret();
  v_url text := 'https://lsxicfgqtdxvlcivlwmd.functions.supabase.co/notify-job-complete';
  v_payload jsonb;
begin
  -- No-op if the secret isn't populated yet (fresh project / pre-handover).
  if v_secret is null or v_secret = '' then
    return null;
  end if;

  v_payload := jsonb_build_object(
    'type', 'UPDATE',
    'table', 'jobs',
    'schema', 'public',
    'record', jsonb_build_object(
      'id', new.id,
      'user_id', new.user_id,
      'status', new.status,
      'finished_at', new.finished_at
    ),
    'old_record', jsonb_build_object(
      'status', old.status
    )
  );

  -- pg_net creates its own `net` schema regardless of WITH SCHEMA target;
  -- net.http_post is async and returns a bigint request id immediately.
  perform net.http_post(
    url := v_url,
    body := v_payload,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );
  return null;
end;
$$;

revoke all on function public.tg_notify_job_complete()
  from public, anon, authenticated;

comment on function public.tg_notify_job_complete() is
  'AFTER UPDATE trigger on public.jobs. Fires only when status transitions to completed. Async POST via pg_net to /notify-job-complete with x-webhook-secret header. Migration 0029.';

-- ----------------------------------------------------------------------------
-- 3. The trigger itself. Guarded on status transition so we never re-fire
--    on idempotent updates.
-- ----------------------------------------------------------------------------
drop trigger if exists notify_job_complete on public.jobs;
create trigger notify_job_complete
  after update of status on public.jobs
  for each row
  when (new.status = 'completed' and old.status is distinct from new.status)
  execute function public.tg_notify_job_complete();

comment on trigger notify_job_complete on public.jobs is
  'Fires public.tg_notify_job_complete() when a job transitions to completed. Migration 0029.';

-- ======== 0030_billing.sql ========
-- 0030_billing.sql -- Stripe-backed subscription tracking (v1.2 Sprint 5)
--
-- ADR 0023 captures the full rationale; the short version:
--
-- 1. We treat Stripe as the source of truth for "is this user paid?".
-- 2. The neo-fm side is intentionally tiny: one table that mirrors the
--    minimum subscription state we need (customer id, subscription id,
--    price id, status, period end, cancel-at-period-end), and one RPC
--    that the /api/billing/webhook route calls with service-role auth.
-- 3. We do not denormalize "tier" into many places. We keep ONE source
--    of tier truth -- public.users.tier -- and the apply RPC updates it
--    atomically with the user_billing upsert. Quotas continue to read
--    from users.tier so nothing else in the system has to know that
--    Stripe exists.
-- 4. Free users have no row in user_billing. Absence = free.
--
-- The /pricing page already exposes Creator (25 songs/mo, ₹399) and
-- Pro (200 songs/mo, ₹1,499). We harmonize user_tier_quota() with those
-- public commitments while we are here, so test-card upgrades unlock
-- exactly what the pricing page promises.

set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. user_billing -- the per-user Stripe state mirror
-- ---------------------------------------------------------------------------

create table if not exists public.user_billing (
  user_id uuid primary key references public.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  stripe_price_id text,
  status text not null default 'inactive'
    check (status in (
      'trialing','active','past_due','canceled','incomplete',
      'incomplete_expired','unpaid','paused','inactive'
    )),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_billing_stripe_customer_uniq
  on public.user_billing (stripe_customer_id);

create index if not exists user_billing_status_idx
  on public.user_billing (status);

comment on table public.user_billing is
  'ADR 0023: Stripe subscription mirror. One row per paying user. Absence = free tier. The /api/billing/webhook route writes here via apply_stripe_subscription_state() with service-role auth.';

alter table public.user_billing enable row level security;

-- The owning user can read their own row to render the account page.
create policy user_billing_select_own on public.user_billing
  for select to authenticated
  using (user_id = auth.uid());

-- Inserts/updates/deletes go through the RPC under service-role.
-- We do not expose a direct write path to clients.

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger so the column stays honest
-- ---------------------------------------------------------------------------

create or replace function public.tg_user_billing_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- search_path is empty so pin pg_catalog explicitly.
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Trigger functions are not meant to be reached via PostgREST RPC.
-- Revoking from anon/authenticated silences advisor 0028/0029 noise.
revoke execute on function public.tg_user_billing_touch_updated_at()
  from public, anon, authenticated;

drop trigger if exists user_billing_touch_updated_at on public.user_billing;
create trigger user_billing_touch_updated_at
  before update on public.user_billing
  for each row execute function public.tg_user_billing_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. apply_stripe_subscription_state -- the only write path
-- ---------------------------------------------------------------------------
--
-- Called by /api/billing/webhook for these Stripe events:
--   - checkout.session.completed       (first upgrade)
--   - customer.subscription.created    (idempotent reinforcement)
--   - customer.subscription.updated    (plan change, status flip)
--   - customer.subscription.deleted    (cancellation at period end)
--
-- The function:
--   1. Upserts user_billing keyed on user_id.
--   2. Resolves the effective tier from (price_id, status):
--      - active/trialing + Creator price  -> 'creator'
--      - active/trialing + Pro price      -> 'pro'
--      - anything else                    -> 'free'
--   3. Updates public.users.tier in the same transaction.
--
-- Price ids are passed in instead of hard-coded so we can rotate prices
-- without a migration (the price ids live in Vercel env, not the
-- database). The MAPPING is configured per call -- the webhook route is
-- the only place that knows which env var maps to which tier.

create or replace function public.apply_stripe_subscription_state(
  p_user_id uuid,
  p_stripe_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_status text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_creator_price_id text,
  p_pro_price_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier public.tier_enum;
  v_is_paying boolean;
begin
  if p_user_id is null then
    raise exception 'missing_user_id' using errcode = '22023';
  end if;
  if coalesce(p_stripe_customer_id, '') = '' then
    raise exception 'missing_customer_id' using errcode = '22023';
  end if;

  v_is_paying := p_status in ('active','trialing');

  if v_is_paying and p_price_id = p_creator_price_id then
    v_tier := 'creator'::public.tier_enum;
  elsif v_is_paying and p_price_id = p_pro_price_id then
    v_tier := 'pro'::public.tier_enum;
  else
    v_tier := 'free'::public.tier_enum;
  end if;

  insert into public.user_billing (
    user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
    status, current_period_end, cancel_at_period_end
  ) values (
    p_user_id, p_stripe_customer_id, p_subscription_id, p_price_id,
    p_status, p_current_period_end, coalesce(p_cancel_at_period_end, false)
  )
  on conflict (user_id) do update set
    stripe_customer_id      = excluded.stripe_customer_id,
    stripe_subscription_id  = excluded.stripe_subscription_id,
    stripe_price_id         = excluded.stripe_price_id,
    status                  = excluded.status,
    current_period_end      = excluded.current_period_end,
    cancel_at_period_end    = excluded.cancel_at_period_end;

  update public.users set tier = v_tier where id = p_user_id;
end;
$$;

comment on function public.apply_stripe_subscription_state(
  uuid, text, text, text, text, timestamptz, boolean, text, text
) is
  'ADR 0023: the only path that mutates user_billing or users.tier in response to a Stripe event. Called by /api/billing/webhook after signature verification under service-role.';

revoke execute on function public.apply_stripe_subscription_state(
  uuid, text, text, text, text, timestamptz, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription_state(
  uuid, text, text, text, text, timestamptz, boolean, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Harmonize tier quotas with /pricing copy
-- ---------------------------------------------------------------------------
--
-- The /pricing page (Sprint E, v1.1) promises 25 songs/mo on Creator
-- and 200 songs/mo on Pro. The previous SQL caps (100 / 1000) were more
-- generous but invisible -- the UI never let anyone reach them because
-- there was no upgrade path. With v1.2 Sprint 5 wiring real billing,
-- the public commitment becomes the cap.

create or replace function public.user_tier_quota(p_user_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select case coalesce(u.tier, 'free'::public.tier_enum)
    when 'free'    then 3
    when 'creator' then 25
    when 'pro'     then 200
  end
  from public.users u where u.id = p_user_id;
$$;

comment on function public.user_tier_quota(uuid) is
  'ADR 0023 (v1.2): songs-per-month cap aligned with /pricing public commitments. free=3, creator=25, pro=200.';
