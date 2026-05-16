-- 0033_language_ta.sql -- v1.3 Sprint 2 (Tamil language)
--
-- Adds Tamil ('ta') to public.language_enum so Tamil-folk presets and
-- the new TamilFolkCoComposer can route through the same hot path the
-- other Indic languages use.
--
-- See migration 0032 for the matching style_family_enum addition.
-- Same ALTER TYPE caveats apply: not in a transaction.
alter type public.language_enum
  add value if not exists 'ta';

comment on type public.language_enum is
  'Lyrics language code. v1.3 (migration 0033) adds "ta" (Tamil) '
  'so the Tamil-folk preset and TamilFolkCoComposer can stop '
  'leaning on language_hint metadata.';
