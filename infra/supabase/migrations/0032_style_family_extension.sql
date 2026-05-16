-- 0032_style_family_extension.sql -- v1.3 Sprint 2 (preset split)
--
-- Adds two new values to public.style_family_enum so we can stop
-- mis-categorising:
--
--   * Bhavageete (a Kannada light-classical lyric form) was being
--     routed through `kannada-folk`. It is NOT folk; it is light-
--     classical sugama-sangeetha. Belongs in its own bucket so the
--     co-composer and downstream tagging can pick the right register.
--   * Tamil folk (parai-style janapada) was also pinned under
--     `kannada-folk` because the schema had no Tamil bucket and no
--     Tamil language code. v1.3 fixes both: the new style value plus
--     migration 0033 add the `ta` language enum.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
-- Postgres 12+, so we issue the two statements as standalone DDL.
-- Supabase migrations are applied one-by-one in their own
-- transactions, so we can simply emit the ALTER TYPE without any
-- enclosing `begin`/`commit` block.
--
-- Reversibility: removing an enum value in PG requires creating a
-- new enum type + ALTER COLUMN TYPE + DROP TYPE, which is a full
-- table rewrite. We do NOT roll this migration back; if we ever
-- need to retire a value the path is a follow-up migration that
-- builds a replacement enum.
alter type public.style_family_enum
  add value if not exists 'kannada-light-classical';

alter type public.style_family_enum
  add value if not exists 'tamil-folk';

comment on type public.style_family_enum is
  'Co-composer routing key. v1.3 (migration 0032) adds '
  '"kannada-light-classical" (bhavageete / sugama-sangeetha) and '
  '"tamil-folk" (parai-style janapada) so they stop being '
  'mis-routed through "kannada-folk".';
