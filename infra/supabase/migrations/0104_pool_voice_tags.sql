-- 0104_pool_voice_tags.sql -- voice tags on the station pool, for gender rotation (lib/station/program.ts) and voice-choice evidence.
-- Nullable columns, so merging code that reads them is safe only if it tolerates missing columns until this is applied.
-- Backfill source: lab/voice-pool/voice.json (Gemini voice judge, scripts/quality/voice-judge.mts), keyed by pool track id
-- through the station queue; instrumentals (language zxx) stay null.

set local search_path = public, extensions;

alter table public.pool_tracks
  add column if not exists voice_gender text check (voice_gender is null or voice_gender in ('female','male','mixed','child','unclear')),
  add column if not exists voice_register text check (voice_register is null or voice_register in ('low','mid','high')),
  add column if not exists voice_timbre text,
  add column if not exists voice_singers int check (voice_singers is null or voice_singers between 1 and 8),
  -- Machine judge, 1 to 5 (5 = indistinguishable from a native singer). Not a native-speaker rating.
  add column if not exists native_score numeric check (native_score is null or native_score between 1 and 5);

create index if not exists pool_tracks_voice_gender_idx
  on public.pool_tracks (language, voice_gender) where status = 'admitted';

comment on column public.pool_tracks.voice_gender is 'Lead voice gender from the Gemini voice judge; drives gender rotation in the station queue.';
comment on column public.pool_tracks.native_score is 'Gemini nativeness score 1-5 (machine judge, not a native-speaker panel).';
