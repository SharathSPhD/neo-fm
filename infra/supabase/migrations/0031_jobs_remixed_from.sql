-- 0031_jobs_remixed_from.sql -- "Make a remix" lineage (v1.2 Sprint 6.3)
--
-- We're adding lightweight lineage to `public.jobs` so remixes link back to
-- the song they were forked from. This unlocks:
--
--   - a "Remixed from: <title>" backlink on the song detail page,
--   - a future "Remixes of this song" feed on the public page,
--   - aggregate analytics (most-remixed songs, remix-share ratios) without
--     digging through song_document JSON.
--
-- Design choices:
--
--   * `remixed_from` is a nullable self-FK on `public.jobs(id)` -- nullable
--     because original songs have no parent.
--   * `on delete set null`: if the parent is hard-deleted we don't want the
--     remix to disappear; we just orphan it. The UI renders "Remixed from a
--     deleted song" in that case.
--   * GIN index would be overkill; a btree on the FK is fine since we'll
--     filter by `remixed_from = $1`.
--
-- RLS: jobs RLS already scopes SELECT to (user_id = auth.uid()) or
-- (published_visibility in ('public','unlisted')). Same predicate applies
-- when joining through remixed_from -- a user can read their own remix
-- regardless of whether the parent is still public/visible to them.

alter table public.jobs
  add column if not exists remixed_from uuid
    references public.jobs(id) on delete set null;

create index if not exists jobs_remixed_from_idx
  on public.jobs(remixed_from)
  where remixed_from is not null;

comment on column public.jobs.remixed_from is
  'If this job was created via /api/songs/[id]/remix, the source job id. NULL for originals. ON DELETE SET NULL so orphaned remixes survive parent deletion.';
