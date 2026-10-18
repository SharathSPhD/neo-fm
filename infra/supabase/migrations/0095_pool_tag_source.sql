-- 0095_pool_tag_source.sql -- say where a pool track's tags came from.
--
-- Mood, theme and genre are inferred (by hand from the transcript, or by a model from the lyrics), never checked by a
-- native speaker. The station ranks on them, so the row has to say they are unverified until someone reviews them.

alter table public.pool_tracks
  add column if not exists tag_source text not null default 'hand_unverified'
    check (tag_source in ('hand_unverified','model_unverified','prompt_derived','reviewed'));

comment on column public.pool_tracks.tag_source is
  'How mood/theme/genre were set. Only reviewed means a person who knows the language checked them.';
