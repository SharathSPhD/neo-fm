-- neo-fm-prod bootstrap, part 2 of 3 (run after part1 succeeded).

-- ======== 0031_jobs_remixed_from.sql ========
-- 0031_jobs_remixed_from.sql -- "Make a remix" lineage (v1.2 Sprint 6.3)
--
-- We're adding lightweight lineage to `public.jobs` so remixes link back to
-- the song they were forked from. This unlocks:
--
--   - a "Remixed from: <title>" backlink on the song detail page,
--   - a future "Remixes of this song" feed on the public page,
--   - aggregate analytics (most-remixed songs, remix-share ratios) without
--     digging through song_document JSON.
--
-- Design choices:
--
--   * `remixed_from` is a nullable self-FK on `public.jobs(id)` -- nullable
--     because original songs have no parent.
--   * `on delete set null`: if the parent is hard-deleted we don't want the
--     remix to disappear; we just orphan it. The UI renders "Remixed from a
--     deleted song" in that case.
--   * GIN index would be overkill; a btree on the FK is fine since we'll
--     filter by `remixed_from = $1`.
--
-- RLS: jobs RLS already scopes SELECT to (user_id = auth.uid()) or
-- (published_visibility in ('public','unlisted')). Same predicate applies
-- when joining through remixed_from -- a user can read their own remix
-- regardless of whether the parent is still public/visible to them.

alter table public.jobs
  add column if not exists remixed_from uuid
    references public.jobs(id) on delete set null;

create index if not exists jobs_remixed_from_idx
  on public.jobs(remixed_from)
  where remixed_from is not null;

comment on column public.jobs.remixed_from is
  'If this job was created via /api/songs/[id]/remix, the source job id. NULL for originals. ON DELETE SET NULL so orphaned remixes survive parent deletion.';

-- ======== 0032_style_family_extension.sql ========
-- 0032_style_family_extension.sql -- v1.3 Sprint 2 (preset split)
--
-- Adds two new values to public.style_family_enum so we can stop
-- mis-categorising:
--
--   * Bhavageete (a Kannada light-classical lyric form) was being
--     routed through `kannada-folk`. It is NOT folk; it is light-
--     classical sugama-sangeetha. Belongs in its own bucket so the
--     co-composer and downstream tagging can pick the right register.
--   * Tamil folk (parai-style janapada) was also pinned under
--     `kannada-folk` because the schema had no Tamil bucket and no
--     Tamil language code. v1.3 fixes both: the new style value plus
--     migration 0033 add the `ta` language enum.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
-- Postgres 12+, so we issue the two statements as standalone DDL.
-- Supabase migrations are applied one-by-one in their own
-- transactions, so we can simply emit the ALTER TYPE without any
-- enclosing `begin`/`commit` block.
--
-- Reversibility: removing an enum value in PG requires creating a
-- new enum type + ALTER COLUMN TYPE + DROP TYPE, which is a full
-- table rewrite. We do NOT roll this migration back; if we ever
-- need to retire a value the path is a follow-up migration that
-- builds a replacement enum.
alter type public.style_family_enum
  add value if not exists 'kannada-light-classical';

alter type public.style_family_enum
  add value if not exists 'tamil-folk';

comment on type public.style_family_enum is
  'Co-composer routing key. v1.3 (migration 0032) adds '
  '"kannada-light-classical" (bhavageete / sugama-sangeetha) and '
  '"tamil-folk" (parai-style janapada) so they stop being '
  'mis-routed through "kannada-folk".';

-- ======== 0033_language_ta.sql ========
-- 0033_language_ta.sql -- v1.3 Sprint 2 (Tamil language)
--
-- Adds Tamil ('ta') to public.language_enum so Tamil-folk presets and
-- the new TamilFolkCoComposer can route through the same hot path the
-- other Indic languages use.
--
-- See migration 0032 for the matching style_family_enum addition.
-- Same ALTER TYPE caveats apply: not in a transaction.
alter type public.language_enum
  add value if not exists 'ta';

comment on type public.language_enum is
  'Lyrics language code. v1.3 (migration 0033) adds "ta" (Tamil) '
  'so the Tamil-folk preset and TamilFolkCoComposer can stop '
  'leaning on language_hint metadata.';

-- ======== 0034_cover_art_jobs.sql ========
-- 0034_cover_art_jobs.sql -- cover-art generation via the DGX sidecar
--
-- v1.3 Sprint 3. Mirror of the song-generation flow for cover art so the
-- Vercel route stops calling HuggingFace inference directly (ADR 0003
-- forbids Vercel -> external GPU in the same request lifecycle). Instead,
-- POST /api/songs/[id]/cover-art enqueues into pgmq; the dgx-worker
-- consumes, calls services/cover-art-synth via HMAC, uploads the PNG to
-- Supabase Storage, and inserts the final artefact into the existing
-- public.cover_art table (migration 0026).
--
-- Surface added:
--
--   1. pgmq queue `cover_art_jobs` (+ DLQ). Created with pgmq.create
--      which is idempotent on re-apply.
--   2. public.cover_art_attempts -- per-attempt audit row. The terminal
--      success row in public.cover_art (with is_current=true) is the
--      artefact; this table answers "what was tried, when, with what
--      prompt, and did it fail?". Distinct from cover_art so a failed
--      attempt does not pollute the artefact table.
--   3. public.enqueue_cover_art_job(p_song_id, p_prompt, p_attempt_id,
--      p_trace_id) -- SECURITY DEFINER RPC that:
--        - asserts the caller owns the song (or it's published)
--        - rate-limits via the same Upstash limiter the route already uses
--          (the limit lives in the route, not the RPC; we only deduplicate
--          identical in-flight attempts here)
--        - inserts the cover_art_attempts row (status='queued')
--        - pgmq.send onto cover_art_jobs
--      Returns (job_id, attempt_id, status). Direct INSERT into
--      cover_art_attempts is revoked from `authenticated` so this RPC
--      is the only path -- same shape as create_song_job.
--   4. Grants on pgmq cover_art_jobs / its DLQ to neo_fm_worker so the
--      DGX worker can consume.

select pgmq.create('cover_art_jobs');
select pgmq.create('cover_art_jobs_dlq');

create table if not exists public.cover_art_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  attempt_id uuid not null,
  prompt text not null check (char_length(prompt) <= 2000),
  status text not null
    check (status in ('queued','processing','completed','failed','dlq')),
  error text,
  trace_id text,
  model_version text,
  -- bucket-relative path of the produced PNG (e.g. <uid>/<song>/<uuid>.png).
  -- Mirrors the convention in public.cover_art.url (which is
  -- "cover-art/<bucket-relative>").
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, attempt_id)
);

create index if not exists cover_art_attempts_job_status_idx
  on public.cover_art_attempts (job_id, status, created_at desc);

comment on table public.cover_art_attempts is
  'v1.3 Sprint 3: per-attempt audit for cover-art generation. The successful artefact lives in public.cover_art; this table records every attempt (including queued / processing / failed / dlq) so the UI can show progress and operators can debug stuck jobs.';

alter table public.cover_art_attempts enable row level security;

drop policy if exists cover_art_attempts_select_own on public.cover_art_attempts;
create policy cover_art_attempts_select_own on public.cover_art_attempts
  for select to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = cover_art_attempts.job_id and j.user_id = auth.uid()
    )
  );

drop policy if exists cover_art_attempts_select_public on public.cover_art_attempts;
create policy cover_art_attempts_select_public on public.cover_art_attempts
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = cover_art_attempts.job_id
        and j.published_visibility in ('public','unlisted')
        and j.public_id is not null
    )
  );

-- Direct INSERT/UPDATE is restricted to service-role + the SECURITY DEFINER
-- RPC below. No grant to `authenticated` here.
revoke all on public.cover_art_attempts from public, anon, authenticated;
grant select on public.cover_art_attempts to authenticated;
grant select on public.cover_art_attempts to anon;
grant insert, update, select on public.cover_art_attempts to neo_fm_worker;

-- updated_at maintenance.
create or replace function public.cover_art_attempts_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cover_art_attempts_touch_trg on public.cover_art_attempts;
create trigger cover_art_attempts_touch_trg
  before update on public.cover_art_attempts
  for each row execute function public.cover_art_attempts_touch();

-- The RPC. Atomic: insert attempt row + pgmq.send. If the pgmq insert
-- fails, the attempt row rolls back so the UI cannot end up showing a
-- ghost "queued" attempt with no corresponding message.
create or replace function public.enqueue_cover_art_job(
  p_song_id uuid,
  p_prompt text,
  p_attempt_id uuid default null,
  p_trace_id text default null
)
returns table(
  job_id uuid,
  attempt_id uuid,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_attempt uuid := coalesce(p_attempt_id, extensions.gen_random_uuid());
  v_trace text := coalesce(p_trace_id, v_attempt::text);
  v_payload jsonb;
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  -- Owner must match -- public/unlisted songs cannot have anonymous
  -- "regenerate" calls; only the owner can re-roll their cover.
  select j.user_id into v_owner from public.jobs j where j.id = p_song_id;
  if v_owner is null then
    raise exception 'song_not_found';
  end if;
  if v_owner <> v_user then
    raise exception 'not_owner';
  end if;

  if p_prompt is null or length(btrim(p_prompt)) = 0 then
    raise exception 'prompt_required';
  end if;
  if length(p_prompt) > 2000 then
    raise exception 'prompt_too_long';
  end if;

  insert into public.cover_art_attempts (
    job_id, attempt_id, prompt, status, trace_id
  ) values (
    p_song_id, v_attempt, p_prompt, 'queued', v_trace
  );

  v_payload := jsonb_build_object(
    'job_id', p_song_id,
    'attempt_id', v_attempt,
    'trace_id', v_trace,
    'prompt', p_prompt,
    'user_id', v_user
  );

  perform pgmq.send('cover_art_jobs', v_payload);

  return query select p_song_id, v_attempt, 'queued'::text;
end;
$$;

revoke execute on function public.enqueue_cover_art_job(uuid, text, uuid, text)
  from public, anon;
grant execute on function public.enqueue_cover_art_job(uuid, text, uuid, text)
  to authenticated;

comment on function public.enqueue_cover_art_job(uuid, text, uuid, text) is
  'v1.3 Sprint 3: enqueue a cover-art generation. Asserts ownership, inserts a cover_art_attempts row, and pgmq.send onto cover_art_jobs in a single transaction. The dgx-worker cover_art consumer is the only thing that drains the queue.';

-- ======== 0035_jobs_favorite_security_definer.sql ========
-- 0035_jobs_favorite_security_definer.sql -- v1.4 Sprint 1, item 7
--
-- Bug: clicking "Favorite" in the library doesn't persist. The optimistic
-- UI flashes "starred" and reverts on the next render.
--
-- Root cause: `public.toggle_favorite` (migration 0022) was declared
-- `security invoker`, which means it runs with the caller's row-level
-- security context. The `jobs` RLS policy set (migration 0005_rls.sql)
-- grants `authenticated` only SELECT + INSERT — there is no UPDATE
-- policy. The UPDATE inside `toggle_favorite` therefore affects zero
-- rows, the function raises `42501 job_not_found_or_forbidden`, the API
-- returns 403, and the UI reverts.
--
-- Fix: recreate `toggle_favorite` as `security definer` and narrow the
-- UPDATE to the caller's own row via `auth.uid()`. This is the same
-- shape as `enqueue_cover_art_job` (migration 0034): owner check is
-- inside the function body, so RLS does not need an UPDATE policy on
-- `public.jobs` for end users.
--
-- We also tighten the function to:
--   * `set search_path = ''` (security-advisor hygiene; matches 0030 fixes)
--   * raise distinct error codes for "not found" vs "not owner" so the
--     API can tell them apart in future.

drop function if exists public.toggle_favorite(uuid);

create function public.toggle_favorite(p_job_id uuid)
returns table (id uuid, is_favorite boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_new boolean;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select j.user_id into v_owner
    from public.jobs j
   where j.id = p_job_id;

  if v_owner is null then
    raise exception 'job_not_found' using errcode = '42501';
  end if;
  if v_owner <> v_user then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update public.jobs
     set is_favorite = not is_favorite
   where public.jobs.id = p_job_id
     and public.jobs.user_id = v_user
   returning public.jobs.is_favorite into v_new;

  if v_new is null then
    -- Race with a delete between the owner check and the UPDATE; treat
    -- as "gone".
    raise exception 'job_not_found' using errcode = '42501';
  end if;

  return query select p_job_id, v_new;
end;
$$;

revoke execute on function public.toggle_favorite(uuid) from public, anon;
grant execute on function public.toggle_favorite(uuid) to authenticated, service_role;

comment on function public.toggle_favorite(uuid) is
  'v1.4 Sprint 1: toggle jobs.is_favorite for the calling user. SECURITY DEFINER so it does not depend on an UPDATE RLS policy on public.jobs; ownership is enforced inside the body.';

-- ======== 0036_cover_art_template.sql ========
-- 0036_cover_art_template.sql -- v1.4 Sprint 1, item 2
--
-- Bug: in production the cover-art panel sticks on "Cover art rendering…"
-- forever. Root cause: `enqueue_cover_art_job` queues onto pgmq
-- `cover_art_jobs`, but the DGX worker only starts its cover-art
-- consumer when both `COVER_ART_SYNTH_URL` and `COVER_ART_SYNTH_HMAC_SECRET`
-- are set (services/dgx-worker/app/worker.py). They are not set in prod,
-- so the queue grows unbounded and the UI polls forever.
--
-- Fix: ship a **template tier** that does NOT use the queue. The UI's
-- default "Generate cover art" button calls a new edge endpoint
-- (apps/web/app/api/songs/[id]/cover-art-template/route.ts) which:
--
--   1. renders a deterministic SVG seeded off the song id + style family
--      + title — no GPU, no queue, < 100 ms latency, < 4 KB payload.
--   2. uploads to Storage (cover-art bucket) via the service-role key.
--   3. calls `public.record_cover_art_template` (this migration) to
--      atomically:
--        - insert a `cover_art_attempts` row with status='completed' and
--          model_version='template-v1';
--        - flip prior `cover_art` rows for this job to is_current=false;
--        - insert the new `cover_art` row with is_current=true.
--
-- The premium tier (z-image / sdxl-turbo via DGX) keeps the existing
-- queued flow behind a `cover_art_premium` feature flag in the UI.
--
-- We also add a `backend` column on `cover_art_attempts` to make
-- per-attempt tier visible in admin queries (no impact on prod data —
-- existing rows backfill to 'diffusion').

alter table public.cover_art_attempts
  add column if not exists backend text;

alter table public.cover_art_attempts
  drop constraint if exists cover_art_attempts_backend_chk;

alter table public.cover_art_attempts
  add constraint cover_art_attempts_backend_chk
  check (backend is null or backend in ('template', 'diffusion'));

update public.cover_art_attempts
   set backend = 'diffusion'
 where backend is null;

create index if not exists cover_art_attempts_job_backend_idx
  on public.cover_art_attempts (job_id, backend, created_at desc);

create or replace function public.record_cover_art_template(
  p_song_id     uuid,
  p_attempt_id  uuid,
  p_prompt      text,
  p_storage_path text,
  p_trace_id    text default null
)
returns table (
  attempt_id uuid,
  cover_art_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_attempt uuid := coalesce(p_attempt_id, extensions.gen_random_uuid());
  v_trace text := coalesce(p_trace_id, v_attempt::text);
  v_cover_id uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select j.user_id into v_owner
    from public.jobs j
   where j.id = p_song_id;
  if v_owner is null then
    raise exception 'song_not_found' using errcode = '42501';
  end if;
  if v_owner <> v_user then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if p_prompt is null or length(btrim(p_prompt)) = 0 then
    raise exception 'prompt_required' using errcode = '22023';
  end if;
  if length(p_prompt) > 2000 then
    raise exception 'prompt_too_long' using errcode = '22023';
  end if;
  if p_storage_path is null or length(btrim(p_storage_path)) = 0 then
    raise exception 'storage_path_required' using errcode = '22023';
  end if;

  -- Attempt row: completed in one shot, no queue.
  insert into public.cover_art_attempts (
    job_id, attempt_id, prompt, status, trace_id,
    model_version, storage_path, backend
  ) values (
    p_song_id, v_attempt, p_prompt, 'completed', v_trace,
    'template-v1', p_storage_path, 'template'
  )
  on conflict (job_id, attempt_id) do update
     set status = excluded.status,
         storage_path = excluded.storage_path,
         model_version = excluded.model_version,
         backend = excluded.backend,
         updated_at = now();

  -- Demote prior covers + insert the new one.
  update public.cover_art
     set is_current = false
   where job_id = p_song_id
     and is_current = true;

  insert into public.cover_art (job_id, prompt, url, model_version, is_current)
  values (p_song_id, p_prompt, 'cover-art/' || p_storage_path, 'template-v1', true)
  returning public.cover_art.id into v_cover_id;

  return query select v_attempt, v_cover_id;
end;
$$;

revoke execute on function public.record_cover_art_template(uuid, uuid, text, text, text)
  from public, anon;
grant execute on function public.record_cover_art_template(uuid, uuid, text, text, text)
  to authenticated, service_role;

comment on function public.record_cover_art_template(uuid, uuid, text, text, text) is
  'v1.4 Sprint 1: record a template-tier cover-art generation in one atomic call. Bypasses pgmq because the template tier renders inline in the Vercel edge runtime in < 100 ms. The diffusion tier still uses enqueue_cover_art_job.';

-- ======== 0037_song_doc_v1_4_widening.sql ========
-- 0037_song_doc_v1_4_widening.sql -- v1.4 Sprint 2 (SongDocument schema)
--
-- Mirrors the Zod widening in `packages/song-doc/src/index.ts`:
--
--   * language_enum picks up `bn` (Bengali), `te` (Telugu), `sa` (Sanskrit)
--     so the v1.4 Indic-corpus presets (rabindrasangeet, keerthana, shloka)
--     can route through the same hot path as en/hi/kn/ta.
--   * style_family_enum picks up four new families:
--       - bollywood-ballad         (Hindi film ballad / love-song)
--       - sanskrit-shloka          (Vedic / devotional chant, Sprint 14)
--       - bengali-rabindrasangeet  (Tagore-style, Sprint 15 preset)
--       - telugu-keerthana         (Tyagaraja-style keerthana, Sprint 15)
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
-- Postgres 12+, so the statements are issued as standalone DDL.
-- Supabase applies migrations one-by-one in their own transactions, so
-- emitting them as plain ALTER TYPE without an enclosing `begin`/`commit`
-- is fine. We also issue `if not exists` so re-running this migration
-- against a partially-applied environment is a no-op.
--
-- The Song Document `voice_id` and `background_mix` fields land inside
-- `public.song_documents.document_json` (the table is JSONB-typed), so
-- they require *no* schema change here. The new fields are validated by
-- the cloud API against the Zod schema before insert, exactly the way
-- the existing `raga` and `orchestration` blocks are.
--
-- Reversibility: same caveat as 0032/0033 — removing an enum value in
-- PG is a full table rewrite, so we do not roll back. A follow-up
-- migration owns the path if we ever need to retire a value.

-- ----- language_enum --------------------------------------------------

alter type public.language_enum
  add value if not exists 'bn';

alter type public.language_enum
  add value if not exists 'te';

alter type public.language_enum
  add value if not exists 'sa';

comment on type public.language_enum is
  'Lyrics language code. v1.4 (migration 0037) adds "bn" (Bengali), '
  '"te" (Telugu), and "sa" (Sanskrit) so the rabindrasangeet, '
  'keerthana, and shloka presets can route through the same hot path '
  'as en/hi/kn/ta. v1.3 (migration 0033) added "ta" (Tamil).';

-- ----- style_family_enum ---------------------------------------------

alter type public.style_family_enum
  add value if not exists 'bollywood-ballad';

alter type public.style_family_enum
  add value if not exists 'sanskrit-shloka';

alter type public.style_family_enum
  add value if not exists 'bengali-rabindrasangeet';

alter type public.style_family_enum
  add value if not exists 'telugu-keerthana';

comment on type public.style_family_enum is
  'Co-composer routing key. v1.4 (migration 0037) adds '
  '"bollywood-ballad", "sanskrit-shloka", "bengali-rabindrasangeet", '
  'and "telugu-keerthana" so the Sprint 6/14/15 presets stop sitting '
  'under "western" or "carnatic" with hint metadata. v1.3 '
  '(migration 0032) added "kannada-light-classical" and "tamil-folk".';

-- ======== 0038_user_presets.sql ========
-- 0038_user_presets.sql -- v1.4 Sprint 4 (creation-canvas: save-as-preset)
--
-- The Advanced disclosure on /songs/new now exposes tempo, key, raga,
-- tala, orchestration, mix, and section tags. Users routinely re-use
-- the same combination across songs ("my Saveri morning ballad" or
-- "my Yaman wedding mode") so we ship a personal preset surface:
--
--   * A `user_presets` table owned by the authenticated user, mirroring
--     the public `style_presets` shape so the existing
--     `PresetGallery` can render both feeds.
--   * RLS scoped to `auth.uid()` for SELECT/INSERT/DELETE — no UPDATE,
--     the workflow is "save a fresh snapshot" not "edit in place".
--   * SECURITY DEFINER RPCs `save_user_preset(...)` and
--     `delete_user_preset(...)` so the API can enforce trim, length,
--     and per-user cap (20 presets/user — keeps the gallery snappy and
--     prevents abuse) without round-tripping the rules through TS.
--
-- The shape stores the full song_document JSON, plus four index
-- columns (style_family / language / target_duration_seconds / title)
-- mirroring `style_presets` so the gallery query is a single index
-- scan, not a JSONB extraction.

set local statement_timeout to '60s';

create table if not exists public.user_presets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  style_family public.style_family_enum not null,
  language    public.language_enum not null,
  target_duration_seconds smallint not null,
  song_document jsonb not null,
  created_at  timestamptz not null default now()
);

comment on table public.user_presets is
  'v1.4 Sprint 4: personal SongDocument presets saved from the creation '
  'canvas Advanced disclosure. Capped at 20 per user; RLS-scoped to '
  'auth.uid(). No UPDATE — re-saving a snapshot creates a fresh row.';

create index if not exists user_presets_user_id_created_idx
  on public.user_presets (user_id, created_at desc);

alter table public.user_presets enable row level security;

drop policy if exists user_presets_select_own on public.user_presets;
create policy user_presets_select_own on public.user_presets
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_presets_insert_own on public.user_presets;
create policy user_presets_insert_own on public.user_presets
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_presets_delete_own on public.user_presets;
create policy user_presets_delete_own on public.user_presets
  for delete to authenticated
  using (user_id = auth.uid());

-- ----- save_user_preset -----------------------------------------------
--
-- Wraps INSERT so the RPC can enforce:
--   1. Title trim + length cap (120 chars; mirrors SONG_TITLE_MAX_CHARS
--      and the song_documents.title constraint).
--   2. Per-user cap (20). When the cap is hit we error with a precise
--      sqlstate so the API can map 409 instead of a generic 500.
--   3. style_family / language / target_duration_seconds extracted from
--      the document_json so the index columns match. The caller may
--      pass them explicitly but we re-derive from JSON to keep the
--      table consistent.
create or replace function public.save_user_preset(
  p_title text,
  p_song_document jsonb
)
returns table (id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_title text;
  v_style public.style_family_enum;
  v_language public.language_enum;
  v_duration smallint;
  v_count integer;
  v_id uuid;
  v_created timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then
    raise exception 'empty_title' using errcode = '22023';
  end if;
  if char_length(v_title) > 120 then
    v_title := left(v_title, 120);
  end if;

  -- Derive index columns from the JSON. Any missing/invalid value
  -- becomes a deliberate validation error so the row is never
  -- partially populated.
  begin
    v_style := (p_song_document ->> 'style_family')::public.style_family_enum;
    v_language := (p_song_document ->> 'language')::public.language_enum;
    v_duration := (p_song_document ->> 'target_duration_seconds')::smallint;
  exception when others then
    raise exception 'invalid_song_document' using errcode = '22023';
  end;

  if v_style is null or v_language is null or v_duration is null then
    raise exception 'invalid_song_document' using errcode = '22023';
  end if;

  select count(*) into v_count
    from public.user_presets
   where user_id = v_uid;

  if v_count >= 20 then
    raise exception 'too_many_presets' using errcode = '23505';
  end if;

  insert into public.user_presets (
    user_id, title, style_family, language,
    target_duration_seconds, song_document
  ) values (
    v_uid, v_title, v_style, v_language, v_duration, p_song_document
  )
  returning public.user_presets.id, public.user_presets.created_at
    into v_id, v_created;

  return query select v_id, v_created;
end;
$$;

revoke execute on function public.save_user_preset(text, jsonb) from public;
grant  execute on function public.save_user_preset(text, jsonb)
  to authenticated, service_role;

comment on function public.save_user_preset(text, jsonb) is
  'v1.4 Sprint 4: insert a personal preset for the authenticated user. '
  'SECURITY DEFINER so RLS does not block when the row goes in; the '
  'function manually enforces auth.uid() ownership, title cap (120 '
  'chars), and per-user cap (20 presets, sqlstate 23505).';

-- ----- delete_user_preset ---------------------------------------------
create or replace function public.delete_user_preset(p_preset_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select user_id into v_owner
    from public.user_presets
   where public.user_presets.id = p_preset_id;

  if v_owner is null then
    raise exception 'preset_not_found' using errcode = '42704';
  end if;
  if v_owner <> v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.user_presets
   where public.user_presets.id = p_preset_id;
end;
$$;

revoke execute on function public.delete_user_preset(uuid) from public;
grant  execute on function public.delete_user_preset(uuid)
  to authenticated, service_role;

-- ======== 0039_voice_samples_bucket.sql ========
-- v1.4 Sprint 5: public `voice-samples` Storage bucket for the 16 voice
-- previews exposed by the voice picker on /songs/new. Each preview is a
-- 10s WAV rendered by `services/vocal-synth/scripts/render_voice_previews.py`
-- and uploaded under `samples/<voice_id>.wav`. The bucket is public so the
-- browser can stream previews without a signed URL round-trip; writes are
-- restricted to the service role (operator runs the script with
-- SUPABASE_SERVICE_ROLE_KEY).

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types, avif_autodetection
) values (
  'voice-samples',
  'voice-samples',
  true,
  10485760, -- 10 MB cap per WAV (10s @ 48k mono is ~960 KB; 10x margin)
  array['audio/wav', 'audio/x-wav'],
  false
) on conflict (id) do nothing;

-- Read access: the bucket is public so the CDN serves objects without
-- RLS. We deliberately do NOT add a broad `select` policy on
-- storage.objects because that would let clients list every file in
-- the bucket (advisor: public_bucket_allows_listing). Object-by-name
-- access via the public URL works regardless.

-- Insert / update / delete: service role only. The render script always
-- authenticates as service role; no other path should write here.
drop policy if exists voice_samples_write_service_role on storage.objects;
create policy voice_samples_write_service_role on storage.objects
  for all to service_role
  using (bucket_id = 'voice-samples')
  with check (bucket_id = 'voice-samples');

-- ======== 0040_publish_song_batch.sql ========
-- 0040_publish_song_batch.sql -- v1.4 Sprint 15
--
-- The library page gains a toolbar batch action so users can select
-- multiple completed songs and publish them all at once. The single-
-- song RPC `publish_song(uuid, text)` (migration 0013) already
-- handles authorisation, visibility, and slug minting per row. This
-- migration ships `publish_song_batch(uuid[], text)` which:
--
--   1. Wraps N single-row publish_song calls in one transaction so
--      either all rows publish or none do (avoids "5 of 7 published"
--      surprises).
--   2. Enforces the free-tier per-user cap (≤ 5 public songs/user)
--      at the database boundary so the UI cannot bypass it by
--      hand-crafting a fan-out of POSTs.
--   3. Returns a per-row outcome (skipped / published / quota_hit /
--      not_found / not_completed) so the toolbar's confirmation
--      modal renders an accurate post-action summary.
--
-- The cap only applies when the requested visibility is `public`;
-- batches of `unlisted` and `private` rows skip the cap (unlisted
-- songs don't appear on /discover so the spam vector is bounded by
-- URL secrecy, not user count).

set local statement_timeout to '60s';

-- 1. Free-tier per-user public quota constant -------------------------------
--    Kept as a plpgsql `case` arm in the function body rather than a
--    settings row so it travels with the migration and can't be
--    silently raised by an operator with `alter database`.
--
--    If neo-fm grows a paid tier, the cap becomes a per-row entry in
--    a future `billing_plans` table. For v1.4 the constant works.

-- 2. Batch RPC --------------------------------------------------------------

create or replace function public.publish_song_batch(
  p_job_ids uuid[],
  p_visibility text
)
returns table (
  job_id uuid,
  public_id text,
  visibility public.song_visibility_enum,
  published_at timestamptz,
  outcome text  -- 'published' | 'already_public' | 'quota_hit' | 'not_found' | 'forbidden' | 'not_completed'
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_visibility public.song_visibility_enum;
  v_free_tier_cap constant integer := 5;
  v_current_public_count integer := 0;
  v_remaining integer;
  v_id uuid;
  v_owner uuid;
  v_status public.job_status_enum;
  v_existing_public_id text;
  v_existing_visibility public.song_visibility_enum;
  v_published_at timestamptz;
  v_new_public_id text;
  v_attempts integer;
begin
  if v_uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  -- Cap the batch fan-out so a runaway client can't pin a
  -- transaction by feeding millions of ids. 100 matches the largest
  -- library page size the toolbar supports.
  if array_length(p_job_ids, 1) is null then
    return;
  end if;
  if array_length(p_job_ids, 1) > 100 then
    raise exception 'batch size exceeds limit (max 100 ids)'
      using errcode = '22023';
  end if;

  begin
    v_visibility := p_visibility::public.song_visibility_enum;
  exception when others then
    raise exception 'invalid visibility: %', p_visibility
      using errcode = '22023';
  end;

  -- Count rows that would consume the quota *before* we mutate
  -- anything. The cap applies to `public` rows only. Unlisted /
  -- private don't push the counter.
  if v_visibility = 'public' then
    select count(*)
      into v_current_public_count
      from public.jobs j
      where j.user_id = v_uid
        and j.published_visibility = 'public';
    v_remaining := v_free_tier_cap - v_current_public_count;
  else
    v_remaining := array_length(p_job_ids, 1);  -- effectively unlimited
  end if;

  foreach v_id in array p_job_ids loop
    select j.user_id, j.status, j.public_id, j.published_visibility, j.published_at
      into v_owner, v_status, v_existing_public_id, v_existing_visibility, v_published_at
      from public.jobs j
      where j.id = v_id;

    if v_owner is null then
      job_id := v_id;
      public_id := null;
      visibility := null;
      published_at := null;
      outcome := 'not_found';
      return next;
      continue;
    end if;

    if v_owner <> v_uid then
      job_id := v_id;
      public_id := null;
      visibility := null;
      published_at := null;
      outcome := 'forbidden';
      return next;
      continue;
    end if;

    if v_status <> 'completed' then
      job_id := v_id;
      public_id := v_existing_public_id;
      visibility := v_existing_visibility;
      published_at := v_published_at;
      outcome := 'not_completed';
      return next;
      continue;
    end if;

    -- Skip rows that are already at the requested visibility — no
    -- point re-publishing what's already public, and the quota
    -- counter shouldn't double-count them.
    if v_existing_visibility = v_visibility and v_existing_public_id is not null then
      job_id := v_id;
      public_id := v_existing_public_id;
      visibility := v_existing_visibility;
      published_at := v_published_at;
      outcome := 'already_public';
      return next;
      continue;
    end if;

    -- Free-tier cap check (public only). Songs that were already
    -- public don't consume the quota again.
    if v_visibility = 'public'
       and v_existing_visibility <> 'public'
       and v_remaining <= 0 then
      job_id := v_id;
      public_id := v_existing_public_id;
      visibility := v_existing_visibility;
      published_at := v_published_at;
      outcome := 'quota_hit';
      return next;
      continue;
    end if;

    -- Mint a public_id on first publish; reuse on subsequent.
    if v_existing_public_id is null and v_visibility <> 'private' then
      v_attempts := 0;
      loop
        v_new_public_id := public.gen_public_id();
        v_attempts := v_attempts + 1;
        begin
          update public.jobs
             set public_id = v_new_public_id,
                 published_visibility = v_visibility,
                 published_at = now()
           where id = v_id
           returning published_at into v_published_at;
          v_existing_public_id := v_new_public_id;
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
       where id = v_id
       returning published_at into v_published_at;
    end if;

    if v_visibility = 'public' and v_existing_visibility <> 'public' then
      v_remaining := v_remaining - 1;
    end if;

    job_id := v_id;
    public_id := v_existing_public_id;
    visibility := v_visibility;
    published_at := v_published_at;
    outcome := 'published';
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.publish_song_batch(uuid[], text) from public;
grant execute on function public.publish_song_batch(uuid[], text) to authenticated;

comment on function public.publish_song_batch(uuid[], text) is
  'v1.4 Sprint 15: batch publish RPC used by the library toolbar. '
  'Wraps N publish_song calls in one transaction; enforces the '
  'free-tier 5-public-songs-per-user cap at the DB boundary; '
  'returns a per-row outcome (published / quota_hit / not_found / '
  'forbidden / not_completed / already_public).';

-- ======== 0041_preference_pairs_and_candidates.sql ========
-- 0041_preference_pairs_and_candidates.sql -- v1.4 Sprint 16 RLHF
--
-- Adds:
--   1. public.tracks.candidate_index  (integer, default 0)
--      Multiple "candidate" renders share the same (job_id) but get
--      distinct candidate_index values. The reranker picks one as
--      `is_current=true`; others stay reachable for re-scoring.
--   2. public.tracks.is_current  (boolean, default true)
--      When candidate generation is OFF (default), there is exactly
--      one track per job with is_current=true. When candidate
--      generation is ON, the reranker sets is_current=true on the
--      top-scoring row and false on the others.
--   3. public.preference_pairs table
--      Stores pairwise preference votes from /songs/<id>/compare.
--      One row per vote. The reward model trains on this table.
--
-- Soft-fail contract: the new columns default such that existing
-- callers keep working without changes. Existing tracks rows backfill
-- with candidate_index=0, is_current=true.

begin;

-- 1. Track candidate metadata --------------------------------------

alter table public.tracks
  add column if not exists candidate_index integer not null default 0;

alter table public.tracks
  add column if not exists is_current boolean not null default true;

-- Drop the old (job_id, attempt_id) uniqueness in favour of
-- (job_id, attempt_id, candidate_index) so the worker can write four
-- candidates that share an attempt_id.
alter table public.tracks
  drop constraint if exists tracks_job_id_attempt_id_key;

create unique index if not exists tracks_job_attempt_candidate_idx
  on public.tracks (job_id, attempt_id, candidate_index);

-- Only one row per job should be current at a time. We use a partial
-- unique index so the constraint is enforced only on `is_current=true`
-- rows; flipping is_current to false during reranker re-selection
-- temporarily lets two rows have is_current=false without violating.
create unique index if not exists tracks_job_current_idx
  on public.tracks (job_id) where is_current = true;

comment on column public.tracks.candidate_index is
  'Top-N candidate index for RLHF reranker. 0 when candidate generation is off.';
comment on column public.tracks.is_current is
  'Exactly one row per job has is_current=true. Reranker may flip this.';

-- 2. preference_pairs ---------------------------------------------

create table if not exists public.preference_pairs (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The two tracks being compared. Both must be on the same job.
  winner_track_id uuid not null references public.tracks(id) on delete cascade,
  loser_track_id  uuid not null references public.tracks(id) on delete cascade,
  -- Reward-model inputs. Kept here so retraining doesn't have to
  -- chase the rest of the schema (style, language can change later).
  style text,
  language text,
  -- For sanity. Free-form because the compare UI may evolve.
  vote_source text not null default 'compare-page',
  created_at timestamptz not null default now(),
  constraint preference_pairs_distinct_tracks
    check (winner_track_id <> loser_track_id)
);

create index if not exists preference_pairs_job_id_idx
  on public.preference_pairs (job_id);
create index if not exists preference_pairs_user_id_idx
  on public.preference_pairs (user_id);
create index if not exists preference_pairs_created_at_idx
  on public.preference_pairs (created_at desc);

alter table public.preference_pairs enable row level security;

-- A user can read their own votes.
drop policy if exists preference_pairs_select_own on public.preference_pairs;
create policy preference_pairs_select_own on public.preference_pairs
  for select to authenticated
  using (user_id = auth.uid());

-- A user can insert votes only for their own jobs and only when the
-- two tracks belong to the same job they own. Enforced via the
-- security-definer RPC below.
drop policy if exists preference_pairs_insert_via_rpc on public.preference_pairs;
create policy preference_pairs_insert_via_rpc on public.preference_pairs
  for insert to authenticated
  with check (false);

comment on table public.preference_pairs is
  'Pairwise RLHF preference votes (Sprint 16). One row per A-vs-B comparison the user resolves on the compare page.';

-- 3. record_preference_pair RPC -----------------------------------

create or replace function public.record_preference_pair(
  p_job_id uuid,
  p_winner_track_id uuid,
  p_loser_track_id uuid,
  p_vote_source text default 'compare-page'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_w_job uuid;
  v_l_job uuid;
  v_style text;
  v_language text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_winner_track_id = p_loser_track_id then
    raise exception 'tracks must differ' using errcode = '22023';
  end if;

  select user_id into v_owner from public.jobs where id = p_job_id;
  if v_owner is null then
    raise exception 'job not found' using errcode = 'P0002';
  end if;
  if v_owner <> v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select job_id into v_w_job from public.tracks where id = p_winner_track_id;
  select job_id into v_l_job from public.tracks where id = p_loser_track_id;
  if v_w_job is null or v_l_job is null then
    raise exception 'track not found' using errcode = 'P0002';
  end if;
  if v_w_job <> p_job_id or v_l_job <> p_job_id then
    raise exception 'tracks belong to a different job' using errcode = '22023';
  end if;

  select
    s.style_family::text,
    s.language::text
  into v_style, v_language
  from public.jobs j
  join public.song_documents s on s.id = j.song_document_id
  where j.id = p_job_id;

  insert into public.preference_pairs (
    job_id, user_id, winner_track_id, loser_track_id,
    style, language, vote_source
  ) values (
    p_job_id, v_uid, p_winner_track_id, p_loser_track_id,
    v_style, v_language, coalesce(p_vote_source, 'compare-page')
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.record_preference_pair(uuid, uuid, uuid, text)
  to authenticated;

comment on function public.record_preference_pair(uuid, uuid, uuid, text) is
  'v1.4 Sprint 16. Owner-only insert into preference_pairs. Validates both tracks belong to the named job and that the caller owns the job.';

commit;

-- ======== 0042_cover_art_bucket.sql ========
-- 0042_cover_art_bucket.sql -- create the `cover-art` Storage bucket
--
-- Why this exists:
--   The Sprint H cover-art table migration (0026_cover_art.sql)
--   declared the `cover-art` bucket "must be created out-of-band in
--   the Supabase dashboard" and never created it. Production never
--   got the bucket, so the cover-art generation UI returns
--   "Bucket not found" the first time a user requests cover art.
--
-- Why a migration:
--   Out-of-band setup didn't survive contact with reality. Putting
--   the bucket in a migration makes it part of the schema we test
--   in CI and apply with `supabase db push`, matching the pattern
--   established for `voice-samples` in 0039_voice_samples_bucket.sql.
--
-- Bucket properties:
--   - PRIVATE: matches `tracks` (0004_queue.sql). Cover-art is
--     personal content; serve via signed URLs minted by the API.
--   - 5 MB cap per object: a square 1024x1024 PNG at quality 95 is
--     ~2.5 MB; a JPEG 95 is ~600 KB. 5 MB gives 2x headroom.
--   - Allowed mime types: PNG, JPEG, WebP. The cover-art-synth
--     service currently produces PNG; WebP is wired for future
--     bandwidth optimization.
--
-- Idempotent: `on conflict (id) do nothing` so re-applying the
-- migration on an environment that has the bucket is a no-op.

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types, avif_autodetection
) values (
  'cover-art',
  'cover-art',
  false,
  5242880, -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp'],
  false
) on conflict (id) do nothing;

-- Storage policies:
--
--   1. Reads are NEVER done by anon/authenticated clients directly.
--      The API mints short-lived signed URLs via the service role
--      (see apps/web/app/api/songs/[id]/cover-art/route.ts), so we
--      don't add a `select` policy here.
--
--   2. Writes are service-role only (the dgx-worker uploads after
--      cover-art-synth renders). Mirroring the voice-samples pattern.

drop policy if exists cover_art_write_service_role on storage.objects;
create policy cover_art_write_service_role on storage.objects
  for all to service_role
  using (bucket_id = 'cover-art')
  with check (bucket_id = 'cover-art');

-- ======== 0043_email_notification_queue.sql ========
-- 0043_email_notification_queue.sql -- queue-backed job-complete emails
--
-- Background:
--   Migration 0029 wired a sync pg_net webhook from public.jobs UPDATE
--   straight into the notify-job-complete Edge Function. That works but
--   has two operational drawbacks:
--     1. A transient Edge Function / Resend outage drops the email
--        silently -- pg_net is fire-and-forget and there is no retry.
--     2. A spike in completed jobs creates a spike in concurrent Edge
--        Function invocations, all racing the same Resend rate limit.
--
--   This migration adds a durable pgmq queue (`email_notifications`)
--   between the trigger and the Edge Function. The Edge Function is now
--   a *drain*: it reads up to N messages on each invocation (cron every
--   2 minutes -- see functions/notify-job-complete/schedule.json) and
--   archives only on successful Resend response. A failure leaves the
--   message visible after its visibility timeout for the next pass.
--
--   The pg_net webhook trigger from 0029 is left untouched for now; the
--   queue-backed path runs alongside it as the durable channel. When
--   the queue path is proven in prod we can drop the 0029 trigger.
--
-- Surface added by this migration:
--   1. pgmq queue `email_notifications` (idempotent: pgmq.create no-ops
--      when the queue already exists, but we still wrap it in DO so a
--      missing pgmq extension doesn't blow up CI).
--   2. public.enqueue_job_complete_email(p_job_id uuid, p_status text)
--      SECURITY DEFINER function. Looks up the user's email + the song
--      title + the job's public_id, then pgmq.send onto the queue.
--   3. Trigger public.jobs_email_notify on public.jobs AFTER UPDATE
--      that calls enqueue_job_complete_email when the row transitions
--      INTO ('completed','failed') from any other status. Self-guarded
--      so re-applying the migration is safe.
--
-- Idempotent across re-application.

-- ---------------------------------------------------------------------
-- 1. Queue creation. pgmq.create is itself idempotent (creates a
--    pgmq.q_<name> + pgmq.a_<name> only if missing), but we guard the
--    SELECT in a DO block so a fresh dev project missing pgmq fails
--    loudly rather than silently.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_extension where extname = 'pgmq'
  ) then
    raise exception
      'pgmq extension is not installed -- expected from 0001_init.sql';
  end if;

  -- pgmq.create raises notice "queue already exists" but does not
  -- error; we still wrap it in a NOT EXISTS check so the migration log
  -- stays clean.
  if not exists (
    select 1 from pgmq.list_queues()
    where queue_name = 'email_notifications'
  ) then
    perform pgmq.create('email_notifications');
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. enqueue_job_complete_email -- the only writer to the queue.
--
--    SECURITY DEFINER so the trigger (running as the row owner) can
--    reach into auth.users and pgmq without granting those schemas to
--    every user. search_path = '' for the usual safety reasons (ADR
--    0021): all object references are fully qualified.
--
--    The function tolerates missing rows gracefully -- if either the
--    auth user or the song_documents row has been deleted between the
--    job UPDATE and this lookup, we still enqueue with NULL values so
--    the Edge Function can decide whether to skip or send a degraded
--    email. The Edge Function's contract is "no email if user_email is
--    null".
-- ---------------------------------------------------------------------
create or replace function public.enqueue_job_complete_email(
  p_job_id uuid,
  p_status text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_email text;
  v_song_title text;
  v_public_id text;
  v_msg_id bigint;
  v_payload jsonb;
begin
  if p_status not in ('completed', 'failed') then
    raise exception
      'enqueue_job_complete_email: p_status must be completed or failed, got %',
      p_status
      using errcode = '22023';
  end if;

  -- Join jobs -> song_documents in one shot so we do not pay for two
  -- index probes. The LEFT JOIN keeps us alive if song_documents was
  -- already cascade-deleted.
  select j.user_id, s.title, j.public_id
    into v_user_id, v_song_title, v_public_id
  from public.jobs j
  left join public.song_documents s on s.id = j.song_document_id
  where j.id = p_job_id;

  if v_user_id is null then
    -- Job row vanished between the trigger fire and now. Log and skip
    -- rather than raising -- the trigger does not want to abort the
    -- original UPDATE because of a notification problem.
    raise warning
      'enqueue_job_complete_email: job % not found, skipping enqueue',
      p_job_id;
    return null;
  end if;

  select email into v_user_email
    from auth.users
   where id = v_user_id;

  v_payload := jsonb_build_object(
    'job_id', p_job_id,
    'user_email', v_user_email,
    'song_title', v_song_title,
    'status', p_status,
    'public_id', v_public_id
  );

  select pgmq.send('email_notifications', v_payload) into v_msg_id;
  return v_msg_id;
end;
$$;

revoke all on function public.enqueue_job_complete_email(uuid, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_job_complete_email(uuid, text)
  to service_role;

alter function public.enqueue_job_complete_email(uuid, text)
  owner to postgres;

comment on function public.enqueue_job_complete_email(uuid, text) is
  'Migration 0043. SECURITY DEFINER. Joins jobs -> song_documents + auth.users to assemble an email notification payload, then pgmq.send onto the email_notifications queue. Returns the pgmq msg_id. Called by the jobs_email_notify trigger.';

-- ---------------------------------------------------------------------
-- 3. Trigger function -- a thin wrapper around enqueue_job_complete_email
--    that the AFTER UPDATE trigger can call. Kept separate so future
--    callers (e.g. an admin re-send RPC) can hit the enqueue helper
--    without going through the trigger.
--
--    SECURITY DEFINER so the trigger runs with rights to reach
--    auth.users via enqueue_job_complete_email's body.
-- ---------------------------------------------------------------------
create or replace function public.tg_enqueue_job_complete_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The WHEN clause on the trigger does the gating; we double-check
  -- here in case the function is invoked outside of the trigger
  -- (e.g. by an operator running UPDATE ... triggered explicitly).
  if new.status in ('completed', 'failed')
     and (old.status is null or old.status not in ('completed', 'failed'))
  then
    perform public.enqueue_job_complete_email(new.id, new.status);
  end if;
  return null;
end;
$$;

revoke all on function public.tg_enqueue_job_complete_email()
  from public, anon, authenticated;

alter function public.tg_enqueue_job_complete_email() owner to postgres;

comment on function public.tg_enqueue_job_complete_email() is
  'Migration 0043. AFTER UPDATE trigger function on public.jobs. Calls public.enqueue_job_complete_email when status transitions into completed/failed from any other state.';

-- ---------------------------------------------------------------------
-- 4. The trigger. Guarded so re-applying the migration is safe.
--    Distinct name from notify_job_complete (migration 0029) so the
--    two paths run in parallel during rollout.
-- ---------------------------------------------------------------------
drop trigger if exists jobs_email_notify on public.jobs;
create trigger jobs_email_notify
  after update of status on public.jobs
  for each row
  when (
    new.status in ('completed', 'failed')
    and (old.status is null or old.status not in ('completed', 'failed'))
  )
  execute function public.tg_enqueue_job_complete_email();

comment on trigger jobs_email_notify on public.jobs is
  'Migration 0043. Enqueues an email_notifications pgmq message when a job transitions into completed/failed. Runs alongside the 0029 pg_net webhook until queue-based path is proven.';

-- ======== 0044_cover_art_bucket_allow_svg.sql ========
-- 0044_cover_art_bucket_allow_svg.sql
--
-- The cover-art-template route (apps/web/app/api/songs/[id]/cover-art-template/route.ts)
-- renders a deterministic SVG and uploads it with contentType "image/svg+xml".
-- Migration 0042 created the cover-art bucket with allowed_mime_types limited to
-- PNG/JPEG/WebP — written independently of the SVG template feature, causing
-- "image/svg+xml is not supported" upload errors on every template render.
--
-- Fix: append image/svg+xml to the bucket's allowed MIME list.
-- SVGs from the template are small (< 4 KB), well within the 5 MB file_size_limit,
-- and served only via signed URLs so there is no public MIME-sniffing risk.
--
-- Idempotent: the NOT (...= ANY(...)) guard makes re-application a no-op.

UPDATE storage.buckets
SET allowed_mime_types = array_append(allowed_mime_types, 'image/svg+xml')
WHERE id = 'cover-art'
  AND NOT ('image/svg+xml' = ANY(allowed_mime_types));

-- ======== 0045_developer_tier_enum.sql ========
-- 0045_developer_tier_enum.sql
--
-- Adds `developer` to tier_enum. Must be committed before any function
-- bodies reference the new value (PostgreSQL restriction on enum values).
-- Migration 0046 adds the updated quota/storage functions and promotes
-- the operator account.

ALTER TYPE public.tier_enum ADD VALUE IF NOT EXISTS 'developer';

-- ======== 0046_developer_tier_functions.sql ========
-- 0046_developer_tier_functions.sql
--
-- Depends on 0045_developer_tier_enum.sql (enum value must be committed first).
--
-- Updates the two tier-quota functions to handle the new `developer` enum value,
-- then promotes the operator account to developer tier.
--
-- developer quota:  999 999 songs/month (effectively unlimited)
-- developer storage: 1 TB (effectively unlimited)

CREATE OR REPLACE FUNCTION public.user_tier_quota(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE COALESCE(u.tier, 'free'::public.tier_enum)
    WHEN 'free'      THEN 3
    WHEN 'creator'   THEN 100
    WHEN 'pro'       THEN 1000
    WHEN 'developer' THEN 999999
  END
  FROM public.users u WHERE u.id = p_user_id;
$$;

COMMENT ON FUNCTION public.user_tier_quota(uuid) IS
  'ADR 0009 / 0045: songs-per-month cap by tier. developer=999999 (effectively unlimited).';

CREATE OR REPLACE FUNCTION public.user_tier_storage_bytes_cap(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE COALESCE(u.tier, 'free'::public.tier_enum)
    WHEN 'free'      THEN 524288000::bigint       -- 500 MB
    WHEN 'creator'   THEN 5368709120::bigint       -- 5 GB
    WHEN 'pro'       THEN 53687091200::bigint      -- 50 GB
    WHEN 'developer' THEN 1099511627776::bigint    -- 1 TB
  END
  FROM public.users u WHERE u.id = p_user_id;
$$;

COMMENT ON FUNCTION public.user_tier_storage_bytes_cap(uuid) IS
  'ADR 0005 / ADR 0045: per-tier storage byte cap. developer=1 TB.';

-- Promote the operator/developer account.
-- This UPDATE is idempotent (re-running sets developer→developer).
UPDATE public.users
SET tier = 'developer'
WHERE email = 'sharath.ai.colab@gmail.com';

-- ======== 0047_voice_samples_allow_json.sql ========
-- v1.5: Allow manifest.json uploads to the voice-samples bucket.
--
-- The render_voice_previews.py script uploads a manifest.json alongside
-- the WAV files so the web picker can distinguish real Parler-TTS previews
-- from FakeVocalModel placeholders without relying on Content-Length alone
-- (both produce 960 044-byte files for 10s × 48kHz mono audio).

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/json')
where id = 'voice-samples'
  and not ('application/json' = any(allowed_mime_types));

-- ======== 0048_fix_email_trigger_enum_cast.sql ========
-- 0048_fix_email_trigger_enum_cast.sql
--
-- The trigger body passes new.status (type: public.job_status_enum) to
-- enqueue_job_complete_email(uuid, text). PostgreSQL won't implicitly
-- cast a user-defined enum to text in function overload resolution, so
-- the worker crashes with "function does not exist" every time it calls
-- mark_failed() or mark_completed().
--
-- Fix: explicitly cast new.status::text in the trigger body.

CREATE OR REPLACE FUNCTION public.tg_enqueue_job_complete_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  if new.status in ('completed', 'failed')
     and (old.status is null or old.status not in ('completed', 'failed'))
  then
    perform public.enqueue_job_complete_email(new.id, new.status::text);
  end if;
  return null;
end;
$function$;

-- ======== 0049_seed_songs_add_target_seconds.sql ========
-- 0049_seed_songs_add_target_seconds.sql
--
-- Seed song documents were created without target_seconds in each section.
-- The Python SongDocument Pydantic model requires it (sum must equal
-- target_duration_seconds). The DGX worker validation fails on every seed
-- job, preventing the discover feed from populating.
--
-- Fix: for any section in a public discover-seed song_document that is
-- missing target_seconds, distribute target_duration_seconds evenly across
-- all sections in that document.
--
-- Idempotent: the EXISTS subquery only matches documents that still have
-- at least one section without target_seconds.

UPDATE public.song_documents sd
SET document_json = (
  SELECT jsonb_set(
    sd.document_json,
    '{sections}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN s ? 'target_seconds' THEN s
          ELSE s || jsonb_build_object(
            'target_seconds',
            (sd.document_json->>'target_duration_seconds')::int
              / jsonb_array_length(sd.document_json->'sections')
          )
        END
      )
      FROM jsonb_array_elements(sd.document_json->'sections') AS s
    )
  )
)
FROM public.jobs j
WHERE j.song_document_id = sd.id
  AND j.published_visibility = 'public'
  AND j.status IN ('processing', 'queued')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(sd.document_json->'sections') AS sec
    WHERE NOT (sec ? 'target_seconds')
  );

-- ======== 0050_cover_art_queue_grants.sql ========
-- 0050_cover_art_queue_grants.sql
--
-- Migration 0006 grants "all tables in schema pgmq to neo_fm_worker" at
-- execution time — a snapshot grant. pgmq.create() in 0034 added new
-- tables (pgmq.q_cover_art_jobs, pgmq.a_cover_art_jobs, and their DLQ
-- counterparts) after 0006 ran, so neo_fm_worker has no rights on them.
--
-- Effect: the dgx-worker cover_art_consumer_loop raises
-- "permission denied for table q_cover_art_jobs" on every poll (every 2 s),
-- flooding logs and wasting DB connections.
--
-- Fix: explicit grants on the four tables and their msg_id sequences.
-- Also add ALTER DEFAULT PRIVILEGES so any future pgmq.create() call
-- from the postgres role grants to neo_fm_worker automatically.

grant select, insert, update, delete
  on pgmq.q_cover_art_jobs         to neo_fm_worker;

grant select, insert, update, delete
  on pgmq.a_cover_art_jobs         to neo_fm_worker;

grant select, insert, update, delete
  on pgmq.q_cover_art_jobs_dlq     to neo_fm_worker;

grant select, insert, update, delete
  on pgmq.a_cover_art_jobs_dlq     to neo_fm_worker;

grant usage
  on sequence pgmq.q_cover_art_jobs_msg_id_seq     to neo_fm_worker;

grant usage
  on sequence pgmq.q_cover_art_jobs_dlq_msg_id_seq to neo_fm_worker;

-- neo_fm_worker also needs DML on public.cover_art to execute the
-- flip_current_cover_art transaction (set old is_current=false, insert new).
-- The original migration 0026 only granted to anon/authenticated/service_role.
grant select, insert, update on public.cover_art to neo_fm_worker;
