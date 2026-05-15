-- 0013_public_songs.sql -- public share surface (M1)
--
-- Sprint 3 adds a publish/share surface for completed songs:
--
--   1. Owner hits "Share" on /songs/[id] -> calls publish_song(...) which:
--        - verifies caller owns the job and it is `completed`
--        - mints a stable, URL-safe `public_id` slug (Crockford-style base32,
--          10 chars, ~50 bits entropy) on first publish; reuses it after
--          unpublish/re-publish so the link stays portable
--        - sets `published_visibility` (public | unlisted | private) and
--          `published_at`
--
--   2. The public song page at /s/[publicId] reads the job + song document +
--      latest track via the service-role client (no auth required) and renders
--      the song. Audio is served via a short-lived signed URL minted on the
--      same request (ADR 0012 Tier 1) with a public refetch endpoint
--      (Tier 2) so long-running browser sessions keep working.
--
--   3. RLS is widened ONLY for SELECT on jobs / tracks / song_documents
--      when published_visibility in ('public','unlisted'). Insert/update/delete
--      policies are unchanged: an unauthenticated visitor cannot mutate.
--      The public-mint endpoints use service_role to bypass RLS for storage
--      signing; the gate is enforced in the API + this column.
--
-- ADR 0013 owns the design.
--
-- This migration is **additive**: existing columns and policies are kept.

create extension if not exists pgcrypto with schema extensions;

-- 1. Visibility enum (new) + columns on public.jobs ----------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'song_visibility_enum' and n.nspname = 'public'
  ) then
    create type public.song_visibility_enum as enum (
      'private',
      'unlisted',
      'public'
    );
  end if;
end
$$;

alter table public.jobs
  add column if not exists public_id text;

alter table public.jobs
  add column if not exists published_at timestamptz;

alter table public.jobs
  add column if not exists published_visibility public.song_visibility_enum
  not null default 'private';

create unique index if not exists jobs_public_id_unique
  on public.jobs (public_id)
  where public_id is not null;

create index if not exists jobs_published_idx
  on public.jobs (published_visibility, published_at)
  where published_visibility <> 'private';

comment on column public.jobs.public_id is
  'Stable URL-safe slug used for /s/[publicId]. NULL until the owner publishes for the first time. Survives unpublish so links stay portable.';
comment on column public.jobs.published_visibility is
  'public = listed + shareable; unlisted = shareable only via link; private = not shareable. RLS widens SELECT only for public/unlisted.';

-- 2. Slug generator ----------------------------------------------------------
--
-- Crockford base32 alphabet (no 0/O, no 1/I, no U). 32 chars, so each char
-- carries 5 bits of entropy. 10 chars = 50 bits, ~1.1e15 combinations.
-- Collision risk at 1e6 published songs is < 1e-3 -- and the publish RPC
-- retries on the unique-index violation anyway.

create or replace function public.gen_public_id()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet text := '0123456789abcdefghjkmnpqrstvwxyz';
  bytes bytea;
  out text := '';
  i integer;
begin
  bytes := extensions.gen_random_bytes(10);
  for i in 0..9 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return out;
end;
$$;

revoke all on function public.gen_public_id() from public;
grant execute on function public.gen_public_id() to authenticated, service_role;

-- 3. Publish/unpublish RPC ---------------------------------------------------

create or replace function public.publish_song(
  p_job_id uuid,
  p_visibility text
)
returns table (
  public_id text,
  visibility public.song_visibility_enum,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.job_status_enum;
  v_owner uuid;
  v_existing_public_id text;
  v_visibility public.song_visibility_enum;
  v_new_public_id text;
  v_attempts integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  -- cast + validate visibility argument
  begin
    v_visibility := p_visibility::public.song_visibility_enum;
  exception when others then
    raise exception 'invalid visibility: %', p_visibility
      using errcode = '22023';
  end;

  select j.user_id, j.status, j.public_id
    into v_owner, v_status, v_existing_public_id
    from public.jobs j
    where j.id = p_job_id;

  if v_owner is null then
    raise exception 'song not found'
      using errcode = 'P0002';
  end if;

  if v_owner <> v_uid then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if v_status <> 'completed' then
    raise exception 'song is not completed (status=%)', v_status
      using errcode = '22023';
  end if;

  -- Only mint a new slug if there is no existing one. Re-publishing
  -- after unpublish reuses the original slug so links remain stable.
  if v_existing_public_id is null and v_visibility <> 'private' then
    loop
      v_new_public_id := public.gen_public_id();
      v_attempts := v_attempts + 1;
      begin
        update public.jobs
           set public_id = v_new_public_id,
               published_visibility = v_visibility,
               published_at = now()
         where id = p_job_id;
        exit;
      exception when unique_violation then
        if v_attempts > 8 then
          raise exception 'failed to mint unique public_id after % attempts',
            v_attempts;
        end if;
      end;
    end loop;
  else
    update public.jobs
       set published_visibility = v_visibility,
           published_at = case
             when v_visibility = 'private' then null
             when v_existing_public_id is null then now()
             else coalesce(published_at, now())
           end
     where id = p_job_id;
  end if;

  return query
    select j.public_id, j.published_visibility, j.published_at
      from public.jobs j
      where j.id = p_job_id;
end;
$$;

revoke all on function public.publish_song(uuid, text) from public;
grant execute on function public.publish_song(uuid, text) to authenticated;

comment on function public.publish_song(uuid, text) is
  'Publish a completed song. Owner-only. Mints stable public_id on first publish; reuses slug on re-publish. ADR 0013.';

-- 4. RLS: read-only widening for published songs -----------------------------

drop policy if exists jobs_select_public on public.jobs;
create policy jobs_select_public on public.jobs
  for select to anon, authenticated
  using (
    published_visibility in ('public', 'unlisted')
    and public_id is not null
  );

drop policy if exists song_documents_select_public on public.song_documents;
create policy song_documents_select_public on public.song_documents
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.song_document_id = song_documents.id
        and j.published_visibility in ('public', 'unlisted')
        and j.public_id is not null
    )
  );

drop policy if exists tracks_select_public on public.tracks;
create policy tracks_select_public on public.tracks
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = tracks.job_id
        and j.published_visibility in ('public', 'unlisted')
        and j.public_id is not null
    )
  );

-- Storage: deliberately NOT widened.  Public visitors get a short-lived
-- signed URL minted server-side by /api/p/[publicId]/audio-url using the
-- service-role key.  That keeps the bucket private while still enabling
-- playback from the share page.
