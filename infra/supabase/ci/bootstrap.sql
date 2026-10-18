-- Minimal Supabase stand-in for a plain Postgres 15/16 (CI + local use).
--
-- Applied once, BEFORE infra/supabase/migrations/*.sql, by scripts/rls-audit.sh.
-- It recreates only the parts of a Supabase project that the migrations and the
-- RLS audit depend on:
--   * roles anon / authenticated / service_role, and Supabase's default privileges
--     (every new public table, view and function is granted to all three; this is
--     why a view is writable by clients unless a migration revokes it)
--   * schema auth (users, uid(), role(), jwt(), email()), driven by request.jwt.claims
--   * schema storage (buckets, objects with RLS, foldername()), the realtime publication
--   * inert shims for the extensions plain Postgres lacks: pgmq, pg_net, pg_cron,
--     pg_jsonschema, vault. They keep the migrations applying; they do no real work.
--
-- Not a security boundary and not a faithful Supabase: it is exactly as strict as the
-- grants and policies the migrations declare, which is what the audit checks.
-- Idempotent: safe to run twice.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Supabase default privileges (as in a fresh project).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------- auth
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  phone text,
  last_sign_in_at timestamptz
);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(auth.jwt() ->> 'role', '')
$$;
create or replace function auth.email() returns text language sql stable as $$
  select nullif(auth.jwt() ->> 'email', '')
$$;
grant execute on function auth.jwt(), auth.uid(), auth.role(), auth.email() to anon, authenticated, service_role;

-- ---------------------------------------------------------------- storage
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  owner_id text
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.buckets, storage.objects to anon, authenticated, service_role;

create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
create or replace function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end $$;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ---------------------------------------------------------------- vault
create schema if not exists vault;
create schema if not exists supabase_vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create or replace view supabase_vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;

-- ---------------------------------------------------------------- pg_net / pg_cron / pg_jsonschema shims
create schema if not exists net;
create or replace function net.http_post(
  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds integer default 5000
) returns bigint language sql as $$ select 0::bigint $$;

create schema if not exists cron;
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ select 0::bigint $$;
create or replace function cron.schedule(schedule text, command text) returns bigint language sql as $$ select 0::bigint $$;

create or replace function extensions.jsonb_matches_schema(schema json, instance jsonb) returns boolean
  language sql immutable as $$ select true $$;
create or replace function extensions.json_matches_schema(schema json, instance json) returns boolean
  language sql immutable as $$ select true $$;

-- ---------------------------------------------------------------- pgmq shim
-- Same table shapes and function signatures as pgmq 1.x, enough for create/send/read/archive.
create schema if not exists pgmq;

create or replace function pgmq.create(queue_name text) returns void language plpgsql as $$
begin
  execute format('create table if not exists pgmq.%I (msg_id bigserial primary key, read_ct int not null default 0,
                  enqueued_at timestamptz not null default now(), vt timestamptz not null default now(), message jsonb)',
                 'q_' || queue_name);
  execute format('create table if not exists pgmq.%I (msg_id bigint primary key, read_ct int not null,
                  enqueued_at timestamptz not null, archived_at timestamptz not null default now(),
                  vt timestamptz not null, message jsonb)', 'a_' || queue_name);
  insert into pgmq.meta (queue_name) values (queue_name) on conflict do nothing;
end $$;

create table if not exists pgmq.meta (
  queue_name text primary key, created_at timestamptz not null default now(),
  is_partitioned boolean not null default false, is_unlogged boolean not null default false
);

create or replace function pgmq.list_queues()
returns table (queue_name text, created_at timestamptz, is_partitioned boolean, is_unlogged boolean)
language sql as $$ select queue_name, created_at, is_partitioned, is_unlogged from pgmq.meta $$;

create or replace function pgmq.send(queue_name text, msg jsonb, delay integer default 0)
returns setof bigint language plpgsql as $$
begin
  return query execute format('insert into pgmq.%I (message, vt) values ($1, now() + make_interval(secs => $2)) returning msg_id',
                              'q_' || queue_name) using msg, delay;
end $$;

create or replace function pgmq.read(queue_name text, vt integer, qty integer)
returns table (msg_id bigint, read_ct integer, enqueued_at timestamptz, vt_at timestamptz, message jsonb)
language plpgsql as $$
begin
  return query execute format(
    'update pgmq.%1$I set read_ct = read_ct + 1, vt = now() + make_interval(secs => $1)
      where msg_id in (select msg_id from pgmq.%1$I where vt <= now() order by msg_id limit $2 for update skip locked)
      returning msg_id, read_ct, enqueued_at, vt, message', 'q_' || queue_name) using vt, qty;
end $$;

create or replace function pgmq.archive(queue_name text, msg_id bigint) returns boolean language plpgsql as $$
declare moved int;
begin
  execute format('with d as (delete from pgmq.%I where msg_id = $1 returning *)
                  insert into pgmq.%I (msg_id, read_ct, enqueued_at, vt, message)
                  select msg_id, read_ct, enqueued_at, vt, message from d', 'q_' || queue_name, 'a_' || queue_name) using msg_id;
  get diagnostics moved = row_count;
  return moved > 0;
end $$;
