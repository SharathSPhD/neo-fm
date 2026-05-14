-- 0001_init.sql -- core schema, extensions, enums, users, subscriptions
--
-- Phase 4a foundation. See docs/SPEC.md §5 for the canonical data model and
-- docs/DECISIONS/0004-worker-db-role.md for the worker role rationale.
--
-- This file lands the dependency surface: extensions, enums, public.users
-- (mirrors auth.users), and the subscriptions table. The auth-side trigger
-- that populates public.users on signup is set up here so a freshly applied
-- migration on a clean project yields a working signup flow.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_jsonschema with schema extensions;

-- Enums (created idempotently so the migration can be re-applied during
-- iteration without dropping the database)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tier_enum') then
    create type public.tier_enum as enum ('free','creator','pro');
  end if;
  if not exists (select 1 from pg_type where typname = 'job_status_enum') then
    create type public.job_status_enum as enum ('queued','processing','completed','failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'language_enum') then
    create type public.language_enum as enum ('en','hi','kn');
  end if;
  if not exists (select 1 from pg_type where typname = 'style_family_enum') then
    create type public.style_family_enum as enum ('western','carnatic','hindustani','kannada-folk');
  end if;
  if not exists (select 1 from pg_type where typname = 'track_format_enum') then
    create type public.track_format_enum as enum ('wav','mp3','flac');
  end if;
end $$;

-- public.users mirrors auth.users 1:1. Application code reads/writes through
-- this table; auth.users stays Supabase-managed. RLS in 0005_rls.sql.
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  locale text,
  tier public.tier_enum not null default 'free',
  created_at timestamptz not null default now()
);

comment on table public.users is
  'Application-facing profile shadowing auth.users (1:1). tier is the only column the user cannot self-mutate (enforced by trigger; see 0005_rls.sql).';

create index if not exists users_email_idx on public.users (email);

-- subscriptions: select-only for users; writes via service_role (billing).
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  plan public.tier_enum not null default 'free',
  status text not null default 'active',
  renew_at timestamptz,
  cancel_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists subscriptions_user_id_uq
  on public.subscriptions (user_id);

-- Auth -> profile bridge. SECURITY DEFINER so it can insert into public.users
-- under elevated privileges; EXECUTE is revoked from anon/authenticated/public
-- below so it is unreachable as an RPC (the advisor lint 0028/0029 flagged this
-- as the security trap).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, name, locale)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'locale', 'en')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user()
  from anon, authenticated, public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
