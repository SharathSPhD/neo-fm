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
