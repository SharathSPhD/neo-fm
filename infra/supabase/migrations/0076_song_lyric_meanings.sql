-- 0076: cached English meaning (machine translation) + romanization for a song's lyrics, generated once per job.
-- Written and read only by the service role via /api/songs/[id]/meaning, which checks job access with the caller's RLS first.
create table if not exists public.song_lyric_meanings (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  lines jsonb not null,
  model text not null,
  created_at timestamptz not null default now()
);
alter table public.song_lyric_meanings enable row level security;
-- No policies: authenticated/anon cannot read or write; service role bypasses RLS.
comment on table public.song_lyric_meanings is
  'Per-job lyric meaning cache: [{section_id, original, roman, english}]. english is an AI machine translation and must be labelled as such in the UI.';
