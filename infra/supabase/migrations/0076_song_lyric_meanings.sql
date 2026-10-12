-- 0076: cached English meaning (machine translation) + romanization for a song's lyrics, generated once per job.
-- Written and read only by the service role via /api/songs/[id]/meaning, which checks job ownership with the caller's RLS first.
-- A failed generation is stored too (status 'failed', no lines) so the route can negative-cache it, and every row counts
-- toward the per-user daily generation cap.
create table if not exists public.song_lyric_meanings (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'ok' check (status in ('ok','failed')),
  lines jsonb,
  model text not null,
  created_at timestamptz not null default now(),
  check ((status = 'ok' and lines is not null) or status = 'failed')
);
create index if not exists song_lyric_meanings_user_created_idx on public.song_lyric_meanings (user_id, created_at desc);
alter table public.song_lyric_meanings enable row level security;
-- No policies: authenticated/anon cannot read or write; service role bypasses RLS.
comment on table public.song_lyric_meanings is
  'Per-job lyric meaning cache: lines = [{section_id, original, roman, english}]. english is an AI machine translation and must be labelled as such in the UI.';
