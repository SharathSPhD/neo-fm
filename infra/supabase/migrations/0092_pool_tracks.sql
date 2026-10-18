-- 0092_pool_tracks.sql -- the station's shared track pool and its tags.
--
-- A pool track is a finished render the service owns and may play to any listener (the radio-style station,
-- not a user's private library). Tags drive station ranking: language, mood, genre, raga, tempo, theme.
-- Admission uses the diction gate (managed-agents/DICTION-GATE.md): a track is only 'admitted' when its
-- order-free score U >= 80 and the verdict is 'pass'. The same rule is enforced by a CHECK constraint, so no
-- code path can admit a track that the gate would hold for review.

set local search_path = public, extensions;

create table if not exists public.pool_tracks (
  id uuid primary key default gen_random_uuid(),
  -- Set when the audio is a prod render; null for eval/quality renders that only exist as files.
  job_id uuid references public.jobs(id) on delete set null,
  source text not null check (source in ('prod_job','eval_render','new_render')),
  -- Storage object path (same convention as tracks.url); a signed URL is minted on read.
  audio_path text not null,
  title text,
  duration_seconds int check (duration_seconds is null or duration_seconds > 0),

  -- Tags. Language codes match song_documents.language; the others are free-form slugs kept lowercase.
  language text not null check (language in ('hi','ta','te','kn','bn','en','sa','hinglish')),
  genre text,
  raga text,
  mood text[] not null default '{}',
  theme text[] not null default '{}',
  tempo_bpm int check (tempo_bpm is null or tempo_bpm between 40 and 220),
  tempo_band text generated always as (
    case when tempo_bpm is null then null
         when tempo_bpm < 80 then 'slow'
         when tempo_bpm < 110 then 'medium'
         else 'fast' end
  ) stored,

  -- Quality evidence the admission rule reads.
  diction_u numeric check (diction_u is null or diction_u between 0 and 100),
  diction_verdict text check (diction_verdict is null or diction_verdict in ('pass','review','rerender')),
  judge_overall numeric check (judge_overall is null or judge_overall between 1 and 5),

  status text not null default 'candidate' check (status in ('candidate','admitted','rejected','retired')),
  admitted_at timestamptz,
  created_at timestamptz not null default now(),

  constraint pool_tracks_audio_unique unique (audio_path),
  -- The diction gate as the admission rule (thresholds from DICTION-GATE.md: pass = U >= 80).
  constraint pool_tracks_admit_requires_gate check (
    status <> 'admitted' or (diction_u >= 80 and diction_verdict = 'pass' and admitted_at is not null)
  )
);

create index if not exists pool_tracks_station_idx
  on public.pool_tracks (language, genre) where status = 'admitted';
create index if not exists pool_tracks_mood_gin on public.pool_tracks using gin (mood) where status = 'admitted';
create index if not exists pool_tracks_theme_gin on public.pool_tracks using gin (theme) where status = 'admitted';

comment on table public.pool_tracks is
  'Station pool: service-owned renders with tags (language, mood, genre, raga, tempo, theme). status=admitted only when the diction gate passes (U>=80, verdict pass). Written under service-role only.';

alter table public.pool_tracks enable row level security;

-- Supabase grants ALL on new public tables to anon/authenticated; listeners only read admitted rows.
revoke all on public.pool_tracks from public, anon, authenticated;
grant select on public.pool_tracks to authenticated;

create policy pool_tracks_select_admitted on public.pool_tracks
  for select to authenticated
  using (status = 'admitted');

-- Admission goes through one function so the gate check and the timestamp cannot be skipped.
create or replace function public.admit_pool_track(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.pool_tracks;
begin
  select * into t from public.pool_tracks where id = p_id for update;
  if not found then
    raise exception 'pool_track_not_found' using errcode = 'P0002';
  end if;
  if t.diction_u is null or t.diction_verdict is distinct from 'pass' or t.diction_u < 80 then
    update public.pool_tracks set status = 'rejected' where id = p_id and status = 'candidate';
    return 'rejected';
  end if;
  update public.pool_tracks set status = 'admitted', admitted_at = coalesce(admitted_at, now()) where id = p_id;
  return 'admitted';
end;
$$;

revoke all on function public.admit_pool_track(uuid) from public, anon, authenticated;
grant execute on function public.admit_pool_track(uuid) to service_role;
