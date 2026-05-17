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
