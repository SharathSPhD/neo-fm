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
