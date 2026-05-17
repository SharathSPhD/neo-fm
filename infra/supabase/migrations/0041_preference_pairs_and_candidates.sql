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
