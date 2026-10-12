-- 0083_client_grants_hardening.sql
-- Threat-model issue #41 (docs/SECURITY-THREAT-MODEL.md, "Supabase hardening").
--
-- Supabase's default grants give anon and authenticated INSERT/UPDATE/DELETE/TRUNCATE on every public table and
-- view; RLS (with no write policy) was the only barrier. Strip those, then grant back exactly the writes the live
-- RLS policies allow, so a future policy mistake no longer exposes a table to client writes.
-- SELECT grants are unchanged. service_role and the worker roles are untouched. public.users is handled by 0070.

-- Idempotent (REVOKE/GRANT/ALTER FUNCTION SET only; no rewrites) and short-locking. Sections 1-4 are independent, so
-- they can be applied separately.
set local lock_timeout = '3s';

-- App audit (client = the signed-in user's Supabase session, not service role): the only direct client writes are
--   songs/[id] DELETE jobs; songs/[id]/feedback INSERT feedback_events; me/taste UPSERT consents, DELETE
--   feedback_events + taste_profiles. Everything else writes through SECURITY DEFINER RPCs or the service role
--   (report, remix lineage, account, admin, agent pipeline). Section 3 grants back exactly those plus the other
--   live write policies. infra/supabase/tests/client_grants.sql asserts the resulting matrix.

-- 1. Views: no client writes (security_invoker views obey base-table RLS, but there is no reason to allow them).
revoke all on public.orphan_jobs from anon, authenticated;
revoke all on public.recent_vocal_quality from anon, authenticated;
revoke all on public.v_user_storage_bytes from anon, authenticated;
revoke all on public.job_stage_latency from anon, authenticated;
-- Signed-in read access that 0027 intended for these two.
grant select on public.recent_vocal_quality, public.v_user_storage_bytes to authenticated;

-- 2. Tables: anon never writes directly (waitlist and feedback go through SECURITY DEFINER RPCs), except reporting.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', t.tablename);
    if t.tablename <> 'users' then
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t.tablename);
    end if;
  end loop;
end $$;

-- 3. Grant back what the live policies allow (one row per write policy that targets these roles).
do $$
declare g record;
begin
  for g in
    select * from (values
      ('song_reports',    'insert',                 'anon, authenticated'),
      ('consents',        'insert, update, delete', 'authenticated'),
      ('feedback_events', 'insert, delete',         'authenticated'),
      ('follows',         'insert, delete',         'authenticated'),
      ('jobs',            'delete',                 'authenticated'),
      ('song_likes',      'insert, delete',         'authenticated'),
      ('taste_profiles',  'delete',                 'authenticated'),
      ('user_presets',    'insert, delete',         'authenticated')
    ) as v(tbl, privs, roles)
  loop
    if to_regclass('public.' || g.tbl) is not null then
      execute format('grant %s on public.%I to %s', g.privs, g.tbl, g.roles);
    end if;
  end loop;
end $$;

-- 4. Trigger function with a mutable search_path (Supabase advisor WARN).
alter function public.cover_art_attempts_touch() set search_path = '';
