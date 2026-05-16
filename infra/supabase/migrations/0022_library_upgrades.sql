-- 0022_library_upgrades.sql -- favorites + library sort indexes (Sprint F)
--
-- Adds `is_favorite` on jobs so the user can star a song from the
-- library, and indexes that make the common filter / sort
-- combinations fast even at 10k+ songs per user.
--
-- Rename and delete don't need new columns: rename mutates the
-- existing `song_documents.title`, and delete piggybacks on the
-- existing `jobs` -> cascade.

alter table public.jobs
  add column if not exists is_favorite boolean not null default false;

comment on column public.jobs.is_favorite is
  'User-toggled favorite flag for /library. Sortable, filterable, RLS-scoped.';

-- Indexes for the common library queries:
--   * "all my songs newest first"  -> (user_id, created_at desc)  (already exists)
--   * "my favorites newest first"  -> partial index on is_favorite=true
--   * sort by oldest, by duration  -> handled at app level (LIMIT 50 is small)

create index if not exists jobs_user_favorites_idx
  on public.jobs (user_id, created_at desc)
  where is_favorite = true;

-- For filter dropdowns (style, language) we read from song_documents,
-- which is already indexed by (user_id, style_family) implicitly via
-- the user_id FK and the small per-user fanout.

-- public.toggle_favorite(p_job_id) -- one round-trip flip. RLS on
-- the underlying table already enforces ownership, but we wrap it
-- in a SECURITY INVOKER function so the API call is concise.
create or replace function public.toggle_favorite(p_job_id uuid)
returns table (id uuid, is_favorite boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new boolean;
begin
  update public.jobs
     set is_favorite = not is_favorite
   where public.jobs.id = p_job_id
   returning public.jobs.is_favorite into v_new;
  if v_new is null then
    raise exception 'job_not_found_or_forbidden' using errcode = '42501';
  end if;
  return query select p_job_id, v_new;
end;
$$;

revoke execute on function public.toggle_favorite(uuid) from public;
grant execute on function public.toggle_favorite(uuid) to authenticated, service_role;

-- public.rename_song(p_job_id, p_title) -- updates song_documents.title.
-- We go through a function so we can bound the length here too and
-- not duplicate the 120-char rule across the codebase.
create or replace function public.rename_song(p_job_id uuid, p_title text)
returns table (id uuid, title text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_doc_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_title = '' then
    raise exception 'empty_title' using errcode = '22023';
  end if;
  if char_length(v_title) > 120 then
    v_title := left(v_title, 120);
  end if;
  select song_document_id into v_doc_id
    from public.jobs
   where public.jobs.id = p_job_id;
  if v_doc_id is null then
    raise exception 'job_not_found_or_forbidden' using errcode = '42501';
  end if;
  update public.song_documents
     set title = v_title
   where public.song_documents.id = v_doc_id;
  return query select p_job_id, v_title;
end;
$$;

revoke execute on function public.rename_song(uuid, text) from public;
grant execute on function public.rename_song(uuid, text) to authenticated, service_role;

-- RLS: allow a user to delete their own jobs. The Postgres FK cascade
-- on tracks / public_songs / song_documents takes care of the related
-- rows. Storage objects are GC'd by a nightly cron, not this transaction.
drop policy if exists jobs_delete_own on public.jobs;
create policy jobs_delete_own on public.jobs
  for delete to authenticated
  using (user_id = auth.uid());
