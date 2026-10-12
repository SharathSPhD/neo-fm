-- public_profiles grant regression test (threat model T-RLS-3, migration 0073).
--
-- public_profiles is an owner-run view over public.users. It must be SELECT-only for anon/authenticated, and
-- no client role may reach other users' rows or sensitive columns through it or through public.users.
--
-- Run locally:  psql "$SUPABASE_DB_URL" -f infra/supabase/tests/public_profiles_grants.sql
-- Run via Supabase MCP: paste into execute_sql. Read-only; raises on the first violation.

do $$
declare
  r  text;
  p  text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(r, 'public.public_profiles', p) then
        raise exception 'public_profiles must not grant % to %', p, r;
      end if;
    end loop;
    if not has_table_privilege(r, 'public.public_profiles', 'SELECT') then
      raise exception 'public_profiles must grant SELECT to %', r;
    end if;
    if has_column_privilege(r, 'public.public_profiles', 'id', 'UPDATE')
       or has_column_privilege(r, 'public.public_profiles', 'handle', 'UPDATE') then
      raise exception 'public_profiles must not grant column UPDATE to %', r;
    end if;
  end loop;

  if has_column_privilege('anon', 'public.users', 'email', 'SELECT')
     or has_column_privilege('anon', 'public.users', 'tier', 'SELECT')
     or has_column_privilege('anon', 'public.users', 'agent_plan', 'SELECT') then
    raise exception 'anon must not read sensitive public.users columns';
  end if;
  if has_table_privilege('anon', 'public.users', 'UPDATE') or has_table_privilege('anon', 'public.users', 'INSERT') then
    raise exception 'anon must not write public.users';
  end if;
  if has_column_privilege('authenticated', 'public.users', 'agent_plan', 'UPDATE')
     or has_column_privilege('authenticated', 'public.users', 'tier', 'UPDATE') then
    raise exception 'authenticated must not update tier or agent_plan';
  end if;
  if (select reloptions::text from pg_class where oid = 'public.public_profiles'::regclass) like '%security_invoker=true%' then
    raise exception 'public_profiles must be owner-run (security_invoker=false)';
  end if;
  raise notice 'public_profiles grant checks passed';
end $$;
