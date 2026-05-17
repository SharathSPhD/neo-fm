-- 0037_song_doc_v1_4_widening.sql -- v1.4 Sprint 2 (SongDocument schema)
--
-- Mirrors the Zod widening in `packages/song-doc/src/index.ts`:
--
--   * language_enum picks up `bn` (Bengali), `te` (Telugu), `sa` (Sanskrit)
--     so the v1.4 Indic-corpus presets (rabindrasangeet, keerthana, shloka)
--     can route through the same hot path as en/hi/kn/ta.
--   * style_family_enum picks up four new families:
--       - bollywood-ballad         (Hindi film ballad / love-song)
--       - sanskrit-shloka          (Vedic / devotional chant, Sprint 14)
--       - bengali-rabindrasangeet  (Tagore-style, Sprint 15 preset)
--       - telugu-keerthana         (Tyagaraja-style keerthana, Sprint 15)
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
-- Postgres 12+, so the statements are issued as standalone DDL.
-- Supabase applies migrations one-by-one in their own transactions, so
-- emitting them as plain ALTER TYPE without an enclosing `begin`/`commit`
-- is fine. We also issue `if not exists` so re-running this migration
-- against a partially-applied environment is a no-op.
--
-- The Song Document `voice_id` and `background_mix` fields land inside
-- `public.song_documents.document_json` (the table is JSONB-typed), so
-- they require *no* schema change here. The new fields are validated by
-- the cloud API against the Zod schema before insert, exactly the way
-- the existing `raga` and `orchestration` blocks are.
--
-- Reversibility: same caveat as 0032/0033 — removing an enum value in
-- PG is a full table rewrite, so we do not roll back. A follow-up
-- migration owns the path if we ever need to retire a value.

-- ----- language_enum --------------------------------------------------

alter type public.language_enum
  add value if not exists 'bn';

alter type public.language_enum
  add value if not exists 'te';

alter type public.language_enum
  add value if not exists 'sa';

comment on type public.language_enum is
  'Lyrics language code. v1.4 (migration 0037) adds "bn" (Bengali), '
  '"te" (Telugu), and "sa" (Sanskrit) so the rabindrasangeet, '
  'keerthana, and shloka presets can route through the same hot path '
  'as en/hi/kn/ta. v1.3 (migration 0033) added "ta" (Tamil).';

-- ----- style_family_enum ---------------------------------------------

alter type public.style_family_enum
  add value if not exists 'bollywood-ballad';

alter type public.style_family_enum
  add value if not exists 'sanskrit-shloka';

alter type public.style_family_enum
  add value if not exists 'bengali-rabindrasangeet';

alter type public.style_family_enum
  add value if not exists 'telugu-keerthana';

comment on type public.style_family_enum is
  'Co-composer routing key. v1.4 (migration 0037) adds '
  '"bollywood-ballad", "sanskrit-shloka", "bengali-rabindrasangeet", '
  'and "telugu-keerthana" so the Sprint 6/14/15 presets stop sitting '
  'under "western" or "carnatic" with hint metadata. v1.3 '
  '(migration 0032) added "kannada-light-classical" and "tamil-folk".';
