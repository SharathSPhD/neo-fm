-- 0084_language_versions.sql
-- "Make it in another language": links sibling language versions of a song.
--
-- version_group is the id of the song the first version was made from (the
-- group's root); every later version, including versions of versions, carries
-- the same value. The root's own row is never modified (it may belong to
-- someone else), so a song's siblings are: the row whose id = group, plus all
-- rows whose version_group = group.
--
-- Hot-table notes: nullable column with no default (metadata-only, no rewrite);
-- the FK needs no validation scan while every row is null; the partial index only
-- covers linked rows. Idempotent.
--
-- No new grants and no views: the column is written only by the create-song API
-- (service role, pinned to the new row's owner) and read through the existing
-- `jobs` RLS, so siblings that are private to someone else stay invisible.
alter table public.jobs
  add column if not exists version_group uuid references public.jobs(id) on delete set null;

create index if not exists jobs_version_group_idx
  on public.jobs (version_group)
  where version_group is not null;

comment on column public.jobs.version_group is
  'Root job of this song''s language-version group; null for songs that were not made as a language version.';
