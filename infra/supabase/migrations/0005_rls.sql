-- 0005_rls.sql -- RLS, policies, storage policies, tier trigger
--
-- Every public-schema table gets RLS. ADR 0004 owns the worker role contract;
-- the policies below are for end users (anon + authenticated). The worker
-- connects as the neo_fm_worker Postgres role created in 0006_worker_role.sql
-- and bypasses RLS by design (least-privilege at the role layer instead).

alter table public.users           enable row level security;
alter table public.song_documents  enable row level security;
alter table public.jobs            enable row level security;
alter table public.tracks          enable row level security;
alter table public.subscriptions   enable row level security;

-- users -- self-select, self-update (tier guarded by trigger below)
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists users_update_self_mutable on public.users;
create policy users_update_self_mutable on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Block tier mutation outside service_role. RLS cannot express
-- "you may UPDATE these columns but not those" so we enforce it in a trigger.
create or replace function public.users_block_tier_self_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.tier is distinct from old.tier and auth.role() <> 'service_role' then
    raise exception 'tier may only be updated by service_role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists users_block_tier_self_update on public.users;
create trigger users_block_tier_self_update
  before update on public.users
  for each row execute function public.users_block_tier_self_update();

-- song_documents -- read+insert by owner, immutable after insert
drop policy if exists song_documents_select_own on public.song_documents;
create policy song_documents_select_own on public.song_documents
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists song_documents_insert_own on public.song_documents;
create policy song_documents_insert_own on public.song_documents
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- jobs -- read+insert by owner; UPDATE/DELETE deny-by-default
-- (worker connects as neo_fm_worker role and is granted UPDATE on selected
--  columns; see 0006_worker_role.sql)
drop policy if exists jobs_select_own on public.jobs;
create policy jobs_select_own on public.jobs
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists jobs_insert_own on public.jobs;
create policy jobs_insert_own on public.jobs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- tracks -- read by owner-of-parent-job; deny insert/update/delete to users
drop policy if exists tracks_select_via_job on public.tracks;
create policy tracks_select_via_job on public.tracks
  for select to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = tracks.job_id
        and j.user_id = (select auth.uid())
    )
  );

-- subscriptions -- read-only for owner; writes via service_role
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Storage policies on storage.objects for bucket 'tracks'.
-- Path convention: tracks/<job_id>/<attempt_id>.<ext>
-- so storage.foldername(name)[1] is the job_id.
drop policy if exists tracks_storage_select_via_job on storage.objects;
create policy tracks_storage_select_via_job on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tracks'
    and exists (
      select 1 from public.jobs j
      where j.id::text = (storage.foldername(name))[1]
        and j.user_id = (select auth.uid())
    )
  );

-- (deliberate absence) -- no INSERT / UPDATE / DELETE storage policies for
-- authenticated; only service_role and the dedicated worker role can write
-- objects to the tracks bucket.
