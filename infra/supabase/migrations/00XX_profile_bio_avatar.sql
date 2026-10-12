-- 00XX_profile_bio_avatar.sql -- public bio and avatar on creator profiles
--
-- Adds users.bio (<= 160 chars) and users.avatar_path, and exposes both through public_profiles.
--
-- Write path: NO column grant is given to `authenticated` for bio or avatar_path (0070 limits updates
-- to handle, name, locale). Both are written only by /api/account/profile and /api/account/avatar with
-- the service client, after moderation, so a direct PostgREST PATCH cannot skip the checks.
--
-- Depends on 0073_public_profiles_owner_view.sql (owner-run view, anon+authenticated SELECT only).
-- This migration keeps its pattern: the view runs as its owner, exposes a fixed column list, and has
-- ALL privileges revoked before SELECT is granted (Supabase default grants include write privileges
-- on new views, which on an owner-run auto-updatable view would let anon modify public.users).

alter table public.users
  add column if not exists bio text,
  add column if not exists avatar_path text,
  add column if not exists avatar_updated_at timestamptz;

alter table public.users drop constraint if exists users_bio_len;
alter table public.users
  add constraint users_bio_len check (bio is null or char_length(bio) <= 160);

-- <user id>/<uuid>.<png|jpg|webp>, the only shape the avatar route writes.
alter table public.users drop constraint if exists users_avatar_path_shape;
alter table public.users
  add constraint users_avatar_path_shape check (
    avatar_path is null
    or avatar_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(png|jpg|webp)$'
  );

-- Appending columns keeps `create or replace view` legal (existing columns keep their order).
create or replace view public.public_profiles
  with (security_invoker = false)
  as
  select id, handle, created_at, bio, avatar_path
    from public.users
   where handle is not null;

comment on view public.public_profiles is
  'Public slice of public.users (id, handle, created_at, bio, avatar_path). Runs as owner on purpose; the users table itself is own-row only.';

revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

-- Avatars are public by design (they render on public profile pages), so the bucket is public-read.
-- Only image types and a 1 MB cap; the API route validates and strips metadata before upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('avatars', 'avatars', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'], false)
on conflict (id) do nothing;

-- Writes are service-role only; no anon/authenticated policy exists, so clients cannot upload directly.
drop policy if exists avatars_write_service_role on storage.objects;
create policy avatars_write_service_role on storage.objects
  for all to service_role
  using (bucket_id = 'avatars')
  with check (bucket_id = 'avatars');
