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
