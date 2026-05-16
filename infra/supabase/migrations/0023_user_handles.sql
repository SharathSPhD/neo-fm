-- 0023_user_handles.sql -- public handles for profile pages (Sprint G)
--
-- Each user picks a global, URL-safe `handle` (3-30 chars, [a-z0-9_],
-- case-insensitive unique). `/u/[handle]` resolves to the public
-- profile, and the UserMenu shows `@handle` once set. Handle is
-- optional at signup; users land on `/onboarding/handle` after
-- their first sign-in until they pick one.
--
-- We don't migrate existing rows; the menu shows "Pick a handle"
-- until the user fills the field.

alter table public.users
  add column if not exists handle text;

-- Case-insensitive uniqueness. Citext would be cleaner but we don't
-- need the extension; the index does the same job.
create unique index if not exists users_handle_lower_uniq
  on public.users (lower(handle))
  where handle is not null;

-- Format check: 3-30 chars, lowercase ASCII letters/digits/underscore.
-- We do the check in a trigger rather than a column check so the
-- error message is friendlier to the API caller and we can return
-- distinct errors (`too_short` vs `bad_chars`).
create or replace function public.validate_handle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.handle is null then
    return new;
  end if;
  new.handle := lower(btrim(new.handle));
  if char_length(new.handle) < 3 then
    raise exception 'handle_too_short' using errcode = '22023';
  end if;
  if char_length(new.handle) > 30 then
    raise exception 'handle_too_long' using errcode = '22023';
  end if;
  if new.handle !~ '^[a-z0-9_]+$' then
    raise exception 'handle_bad_chars' using errcode = '22023';
  end if;
  if new.handle in ('admin','root','support','help','about','api','www','neo','neofm','neo-fm','songs','library','discover','pricing','feedback','account','signin','signup','sign-in','sign-up','auth','s','u','public') then
    raise exception 'handle_reserved' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists users_validate_handle on public.users;
create trigger users_validate_handle
  before insert or update of handle on public.users
  for each row execute function public.validate_handle();

comment on column public.users.handle is
  'Lowercase URL-safe handle (3-30 chars, [a-z0-9_]). Globally unique. Picked at /onboarding/handle.';

-- public.claim_handle(p_handle) -- typed errors, RLS-respecting via
-- security invoker. Used by the onboarding flow.
create or replace function public.claim_handle(p_handle text)
returns table (handle text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text := lower(btrim(coalesce(p_handle, '')));
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  update public.users
     set handle = v_handle
   where public.users.id = v_uid;
  return query select v_handle;
exception
  when unique_violation then
    raise exception 'handle_taken' using errcode = '23505';
end;
$$;

revoke execute on function public.claim_handle(text) from public;
grant execute on function public.claim_handle(text) to authenticated, service_role;

-- RLS: allow any signed-in or anon user to SELECT (id, handle) of a
-- public profile. Email and tier remain private. We narrow the
-- exposed columns via a view.
create or replace view public.public_profiles as
  select id, handle, created_at
    from public.users
   where handle is not null;

comment on view public.public_profiles is
  'Anonymous-readable subset of public.users. id + handle + member-since only.';

grant select on public.public_profiles to anon, authenticated;
