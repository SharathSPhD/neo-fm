-- Client write-grant matrix (issue #41, migration 0083). Read-only: raises on the first violation.
--   psql "$SUPABASE_DB_URL" -f infra/supabase/tests/client_grants.sql   (or paste into Supabase MCP execute_sql)
--
-- Direct client writes the app relies on (see the audit in 0083) must stay granted; nothing else may be.
do $$
declare
  t record;
  p text;
  r text;
  allowed text[];
begin
  -- (table, role, privilege) that MUST be granted: backed by a live RLS policy and/or an app route.
  for t in
    select * from (values
      ('jobs', 'authenticated', 'delete'),
      ('feedback_events', 'authenticated', 'insert'), ('feedback_events', 'authenticated', 'delete'),
      ('consents', 'authenticated', 'insert'), ('consents', 'authenticated', 'update'), ('consents', 'authenticated', 'delete'),
      ('taste_profiles', 'authenticated', 'delete'),
      ('follows', 'authenticated', 'insert'), ('follows', 'authenticated', 'delete'),
      ('song_likes', 'authenticated', 'insert'), ('song_likes', 'authenticated', 'delete'),
      ('user_presets', 'authenticated', 'insert'), ('user_presets', 'authenticated', 'delete'),
      ('song_reports', 'authenticated', 'insert'), ('song_reports', 'anon', 'insert')
    ) as v(tbl, rol, priv)
  loop
    if to_regclass('public.' || t.tbl) is not null and not has_table_privilege(t.rol, 'public.' || t.tbl, t.priv) then
      raise exception 'missing required grant: % % on %', t.rol, t.priv, t.tbl;
    end if;
  end loop;

  -- Everything else must have no client INSERT/UPDATE/DELETE/TRUNCATE.
  for t in select tablename from pg_tables where schemaname = 'public' loop
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['insert', 'update', 'delete', 'truncate'] loop
        allowed := case r || '.' || t.tablename
          when 'anon.song_reports' then array['insert']
          when 'authenticated.song_reports' then array['insert']
          when 'authenticated.jobs' then array['delete']
          when 'authenticated.feedback_events' then array['insert', 'delete']
          when 'authenticated.consents' then array['insert', 'update', 'delete']
          when 'authenticated.taste_profiles' then array['delete']
          when 'authenticated.follows' then array['insert', 'delete']
          when 'authenticated.song_likes' then array['insert', 'delete']
          when 'authenticated.user_presets' then array['insert', 'delete']
          else array[]::text[]
        end;
        -- public.users column grants are covered by public_profiles_grants.sql (0070)
        if t.tablename <> 'users' and not (p = any (allowed)) and has_table_privilege(r, 'public.' || t.tablename, p) then
          raise exception 'unexpected client grant: % % on %', r, p, t.tablename;
        end if;
      end loop;
    end loop;
  end loop;

  foreach r in array array['orphan_jobs', 'recent_vocal_quality', 'v_user_storage_bytes', 'job_stage_latency'] loop
    if to_regclass('public.' || r) is not null
       and (has_table_privilege('anon', 'public.' || r, 'select,insert,update,delete')
            or has_table_privilege('authenticated', 'public.' || r, 'insert,update,delete')) then
      raise exception 'view % must not be client-writable or anon-readable', r;
    end if;
  end loop;
  raise notice 'client grant matrix ok';
end $$;
