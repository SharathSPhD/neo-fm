-- 0081_collections.sql
-- User playlists ("collections") with private / unlisted / public visibility.
--
-- Writes are service-role only: titles and descriptions are public on shared collections, so every write goes through
-- an API route that authenticates the caller, moderates the text and checks song eligibility first (same lesson as
-- the dedication RPC, 0074). Owners may read their own rows directly; everything public is served by the app from the
-- service client after an explicit visibility check, so no anon access and no views are exposed.
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  description text check (description is null or char_length(description) <= 280),
  visibility text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
  public_id text not null unique check (public_id ~ '^[0-9abcdefghjkmnpqrstvwxyz]{10}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collections_user_idx on public.collections (user_id, updated_at desc);

create table if not exists public.collection_items (
  collection_id uuid not null references public.collections(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  position int not null default 0,
  added_at timestamptz not null default now(),
  primary key (collection_id, job_id)
);

create index if not exists collection_items_job_idx on public.collection_items (job_id);

alter table public.collections enable row level security;
alter table public.collection_items enable row level security;

drop policy if exists collections_select_own on public.collections;
create policy collections_select_own on public.collections
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists collection_items_select_own on public.collection_items;
create policy collection_items_select_own on public.collection_items
  for select to authenticated using (
    exists (
      select 1 from public.collections c
      where c.id = collection_items.collection_id and c.user_id = (select auth.uid())
    )
  );

-- Supabase grants broad default privileges; strip them, then grant only owner reads (RLS-filtered).
revoke all on public.collections from public, anon, authenticated;
revoke all on public.collection_items from public, anon, authenticated;
grant select on public.collections to authenticated;
grant select on public.collection_items to authenticated;
grant all on public.collections to service_role;
grant all on public.collection_items to service_role;
