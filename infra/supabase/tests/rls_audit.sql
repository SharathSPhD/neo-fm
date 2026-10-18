-- RLS audit: can a signed-out visitor (anon) or another signed-in user (authenticated) read or
-- write someone else's rows, on any table or view in `public`?
--
--   RLS_AUDIT_DB_URL=postgresql://... scripts/rls-audit.sh        (CI: job "rls audit")
--
-- Runs against a database with every migration applied (see scripts/rls-audit.sh and
-- infra/supabase/ci/bootstrap.sql). Everything happens in one transaction that is rolled back,
-- so it also works against a scratch database you want to keep. It raises on the first failing
-- section with every violation of that section listed.
--
-- WHAT IS CHECKED
--  1. Completeness: every table and view in `public` is classified in rls_audit.expect below.
--     A new table or view with no entry FAILS this audit on purpose; the author must say who may
--     read it. (kinds: owner | public_read | service | insert_only | view_blocked | view_owner | view_public)
--  2. Structure (catalogs): RLS enabled on every table; no client TRUNCATE/REFERENCES/TRIGGER; no
--     client write grant on any view; every view a client can SELECT is security_invoker, or is an
--     explicitly listed public view with an exact column list; no materialized view readable by clients
--     (they have no RLS); no `using (true)` policy for anon/authenticated outside public_read tables;
--     no SECURITY DEFINER function executable by anon/authenticated outside the allowlist.
--     This is the "revoke before grant" rule for views: Supabase grants ALL on every new public
--     object to anon and authenticated, so a view is writable until a migration revokes it.
--  3. Behaviour: one private row is seeded for user A in every table (foreign keys followed). Then,
--     as anon and as signed-in user B, against A's rows: SELECT must see nothing, UPDATE/DELETE must
--     touch nothing, INSERT of a row owned by A must be rejected. Controls: A can read own rows
--     (owner tables), service_role can read the seeded row (proves the seed is real).
--
-- If you add a table: add it to rls_audit.expect (and, if the generic seeder cannot build a valid
-- row because of a CHECK constraint, to rls_audit.seed_override).

begin;
set local client_min_messages = warning;

create schema rls_audit;

-- ----------------------------------------------------------------------------- users A and B
-- Created first, with triggers active, exactly like sign-up (handle_new_user etc. run).
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
values ('aaaaaaaa-0000-4000-8000-00000000000a', 'a@rls-audit.test', '{}', now()),
       ('bbbbbbbb-0000-4000-8000-00000000000b', 'b@rls-audit.test', '{}', now());

-- ----------------------------------------------------------------------------- expectations
-- owner         RLS-scoped to one user. Others (anon, B) must read none of A's rows. A reads own.
-- public_read   rows are readable by everyone by design (note says why). Others still cannot write A's.
-- service       no client may read or write any row. Only service_role / the worker.
-- insert_only   clients may insert (with an ownership check) but never read.
-- view_blocked  no client privilege at all.
-- view_owner    security_invoker view over owner tables; B must see none of A's rows.
-- view_public   intentionally readable by everyone; must expose exactly `cols`.
create table rls_audit.expect (
  name text primary key,
  kind text not null check (kind in ('owner','public_read','service','insert_only','view_blocked','view_owner','view_public')),
  owner_col text,                 -- column holding the owning user id (null = reached through a parent)
  cols text[],                    -- view_public only
  note text
);
insert into rls_audit.expect (name, kind, owner_col, cols, note) values
  -- user-owned data
  ('users',              'owner', 'id',      null, 'own profile row; public fields go through public_profiles'),
  ('jobs',               'owner', 'user_id', null, 'published songs are public via jobs_select_public; seeded row is private'),
  ('song_documents',     'owner', 'user_id', null, null),
  ('tracks',             'owner', null,      null, 'via jobs'),
  ('track_stems',        'owner', null,      null, 'via jobs'),
  ('cover_art',          'owner', null,      null, 'via jobs'),
  ('cover_art_attempts', 'owner', null,      null, 'via jobs'),
  ('subscriptions',      'owner', 'user_id', null, null),
  ('user_billing',       'owner', 'user_id', null, null),
  ('song_packs',         'owner', 'user_id', null, 'owner reads own credits; grant_song_pack/consume_pack_song are service-role only'),
  ('consents',           'owner', 'user_id', null, null),
  ('taste_profiles',     'owner', 'user_id', null, null),
  ('user_presets',       'owner', 'user_id', null, null),
  ('feedback_events',    'owner', 'user_id', null, null),
  ('preference_pairs',   'owner', 'user_id', null, 'insert only through record_preference_pair()'),
  ('collections',        'owner', 'user_id', null, 'public collections are read via the service-role page loader, not PostgREST'),
  ('collection_items',   'owner', null,      null, 'via collections'),
  ('notifications',      'owner', 'user_id', null, 'owner reads own rows; every write goes through notify_user() with the service role'),
  ('notification_prefs', 'owner', 'user_id', null, 'owner reads own rows; writes go through the API with the service role'),
  -- social graph, readable by design
  ('follows',            'public_read', 'follower_id', null, 'follower lists are public'),
  ('song_likes',         'public_read', 'user_id',     null, 'like counts and lists are public'),
  -- clients may file reports but never read them
  ('song_reports',       'insert_only', 'reporter_id', null, 'anon may insert with reporter_id null; signed-in users as themselves'),
  -- service-only tables: RLS on, no client policy
  ('agent_runs',            'service', null,      null, null),
  ('client_errors',         'service', null,      null, 'written by /api/client-error with the service role'),
  ('config_versions',       'service', null,      null, null),
  ('eval_judgments',        'service', null,      null, null),
  ('eval_runs',             'service', null,      null, null),
  ('review_items',          'service', null,      null, 'native-review kit; service role only'),
  ('review_tokens',         'service', null,      null, 'hashed reviewer links; service role only'),
  ('review_ratings',        'service', null,      null, 'reviewer ratings; service role only'),
  ('song_lyric_meanings',   'service', null,      null, 'meaning cache; ownership is checked by the route with the caller RLS, rows are service role only'),
  ('ui_review_tokens',      'service', null,      null, 'hashed UI-translation reviewer links; service role only'),
  ('ui_review_edits',       'service', null,      null, 'reviewer verdicts on UI strings; service role only'),
  ('feedback',              'service', 'user_id', null, 'submitted via submit_feedback(); read by service role only'),
  ('funnel_daily',          'service', null,      null, null),
  ('pool_tracks',           'service', null,      null, 'station pool; the station route reads admitted rows with the service role'),
  ('song_listens',          'service', null,      null, 'anonymous play/share events; creators read aggregates via security definer functions'),
  ('song_listens_daily',    'service', null,      null, 'daily roll-up of song_listens; service role only'),
  ('health_snapshots',      'service', null,      null, null),
  ('job_assignments',       'service', null,      null, null),
  ('job_telemetry',         'service', null,      null, null),
  ('push_subscriptions',    'service', 'user_id', null, 'endpoints and keys are credentials: API routes with the service role only'),
  ('spend_ledger',          'service', null,      null, null),
  ('stripe_webhook_events', 'service', null,      null, null),
  ('user_spend',            'service', 'user_id', null, null),
  ('waitlist',              'service', 'user_id', null, 'joined via join_waitlist()'),
  -- views
  ('client_error_groups_24h', 'view_blocked', null,      null, null),
  ('job_stage_latency',       'view_blocked', null,      null, null),
  ('orphan_jobs',             'view_blocked', null,      null, null),
  ('recent_vocal_quality',    'view_owner',   'user_id', null, null),
  ('v_user_storage_bytes',    'view_owner',   'user_id', null, null),
  ('public_profiles',         'view_public',  null,
     array['avatar_path','bio','created_at','handle','id'],
     'definer view on purpose: exposes only these columns of users, only for rows with a handle');

-- Seed values for NOT NULL columns whose generic dummy would violate a CHECK constraint.
-- (name, column, SQL expression)
create table rls_audit.seed_override (name text, col text, expr text, primary key (name, col));
insert into rls_audit.seed_override (name, col, expr) values
  ('collections',            'public_id',    '''0123456789'''),
  ('notifications',          'type',         '''like'''),
  ('push_subscriptions',     'endpoint',     '''https://push.example/audit'''),
  ('agent_runs',             'agent_key',    '''free'''),
  ('agent_runs',             'status',       '''pending'''),
  ('config_versions',        'status',       '''draft'''),
  ('consents',               'purpose',      '''personalize'''),
  ('cover_art_attempts',     'status',       '''queued'''),
  ('eval_judgments',         'winner',       '''tie'''),
  ('eval_runs',              'arm',          '''pce'''),
  ('eval_runs',              'status',       '''pending'''),
  ('feedback_events',        'kind',         '''like'''),
  ('funnel_daily',           'event',        '''landing_view'''),
  ('pool_tracks',           'source',       '''new_render'''),
  ('pool_tracks',           'language',     '''hi'''),
  ('song_packs',             'sku',          '''single'''),
  ('song_packs',             'songs_total',  '1'),
  ('stripe_webhook_events',  'status',       '''processing'''),
  ('review_items',          'language',     '''hi'''),
  ('review_tokens',         'language',     '''hi'''),
  ('song_lyric_meanings',   'lines',        '''[]''::jsonb'),
  ('ui_review_tokens',      'language',     '''hi'''),
  ('ui_review_edits',       'action',       '''approve'''),
  ('song_listens',          'kind',         '''play'''),
  ('song_listens_daily',    'kind',         '''play'''),
  ('track_stems',            'kind',         '''master'''),
  ('waitlist',               'tier',         '''creator'''),
  ('preference_pairs',       'loser_track_id',  'gen_random_uuid()'),   -- must differ from winner_track_id
  ('follows',                'followee_id',  '''bbbbbbbb-0000-4000-8000-00000000000b'''); -- follower <> followee

-- ----------------------------------------------------------------------------- 1. completeness
do $$
declare missing text; stale text;
begin
  select string_agg(c.relname || ' (' || case c.relkind when 'v' then 'view' when 'm' then 'matview' else 'table' end || ')', ', ' order by c.relname)
    into missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p','v','m')
     and not exists (select 1 from rls_audit.expect e where e.name = c.relname);
  if missing is not null then
    raise exception 'RLS audit: unclassified public relations (add them to rls_audit.expect in infra/supabase/tests/rls_audit.sql): %', missing;
  end if;

  select string_agg(e.name, ', ') into stale
    from rls_audit.expect e
   where to_regclass('public.' || quote_ident(e.name)) is null;
  if stale is not null then
    raise exception 'RLS audit: rls_audit.expect lists relations that no longer exist: %', stale;
  end if;
end $$;

-- ----------------------------------------------------------------------------- 2. structure
do $$
declare
  r record;
  bad text[] := '{}';
  p text;
  client_roles text[] := array['anon','authenticated'];
  role_name text;
begin
  -- RLS on for every table
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
  loop
    bad := bad || format('table %s has row level security disabled', r.relname);
  end loop;

  -- no TRUNCATE / REFERENCES / TRIGGER for clients on any table, view or matview
  for r in select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p','v','m')
  loop
    foreach role_name in array client_roles loop
      foreach p in array array['truncate','references','trigger'] loop
        if has_table_privilege(role_name, format('public.%I', r.relname), p) then
          bad := bad || format('%s has %s on %s', role_name, upper(p), r.relname);
        end if;
      end loop;
    end loop;
  end loop;

  -- views: never writable by clients; readable only if listed, and then security_invoker (or an explicit public view)
  for r in select c.relname, c.relkind, coalesce(c.reloptions::text, '') ~ 'security_invoker=(true|on)' as invoker, e.kind
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
             join rls_audit.expect e on e.name = c.relname
            where n.nspname = 'public' and c.relkind in ('v','m')
  loop
    foreach role_name in array client_roles loop
      foreach p in array array['insert','update','delete'] loop
        if has_table_privilege(role_name, format('public.%I', r.relname), p) then
          bad := bad || format('%s can %s view %s (revoke all ... from anon, authenticated before granting select)', role_name, upper(p), r.relname);
        end if;
      end loop;
      if has_table_privilege(role_name, format('public.%I', r.relname), 'select') then
        if r.relkind = 'm' then
          bad := bad || format('%s can select materialized view %s (matviews have no RLS)', role_name, r.relname);
        elsif r.kind = 'view_blocked' then
          bad := bad || format('%s can select view %s, which is classified view_blocked', role_name, r.relname);
        elsif r.kind = 'view_owner' and not r.invoker then
          bad := bad || format('view %s is readable by %s but is not security_invoker, so it bypasses RLS on its base tables', r.relname, role_name);
        elsif r.kind = 'view_owner' and role_name = 'anon' then
          bad := bad || format('anon can select view %s, which is owner-scoped', r.relname);
        end if;
      end if;
    end loop;
    if r.kind = 'view_public' and r.invoker then
      bad := bad || format('view %s is classified view_public but is security_invoker (it would return no rows to clients)', r.relname);
    end if;
  end loop;

  -- view_public views: exact column list
  for r in select e.name, e.cols, (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                                    where a.attrelid = format('public.%I', e.name)::regclass and a.attnum > 0 and not a.attisdropped) as actual
             from rls_audit.expect e where e.kind = 'view_public'
  loop
    if r.actual is distinct from r.cols then
      bad := bad || format('public view %s exposes columns {%s}, expected exactly {%s}', r.name, array_to_string(r.actual, ','), array_to_string(r.cols, ','));
    end if;
  end loop;

  -- policies that let everyone in
  for r in select pol.tablename, pol.policyname, pol.cmd
             from pg_policies pol join rls_audit.expect e on e.name = pol.tablename
            where pol.schemaname = 'public'
              and (pol.roles && array['anon','authenticated','public']::name[])
              and (regexp_replace(coalesce(pol.qual, ''), '\s', '', 'g') in ('true', '(true)')
                   or regexp_replace(coalesce(pol.with_check, ''), '\s', '', 'g') in ('true', '(true)'))
              and not (e.kind = 'public_read' and pol.cmd = 'SELECT')
  loop
    bad := bad || format('policy %s.%s (%s) is "true" for client roles', r.tablename, r.policyname, r.cmd);
  end loop;

  -- SECURITY DEFINER functions clients can execute: each is a way around RLS, so each is listed here.
  for r in select p.oid::regprocedure::text as sig, p.proname
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
              and p.proname <> all (array[
                -- each of these derives the user from auth.uid() (never from an argument) and is the app's sanctioned write path
                'create_song_job','create_section_regen_job','publish_song','publish_song_batch','recover_song_job',
                'enqueue_cover_art_job','record_cover_art_template','toggle_favorite','save_user_preset','delete_user_preset',
                'record_preference_pair',
                -- read-only aggregates over the caller's own songs (auth.uid() filter inside; anon has no execute)
                'creator_insights_daily','creator_top_languages','creator_best_song_week',
                -- anonymous-safe by design (validate + insert only)
                'join_waitlist','submit_feedback'])
  loop
    bad := bad || format('SECURITY DEFINER function %s is executable by anon/authenticated and not in the audit allowlist', r.sig);
  end loop;

  -- anon may execute only the two anonymous-safe definer functions above
  for r in select p.oid::regprocedure::text as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
              and has_function_privilege('anon', p.oid, 'execute')
              and p.proname <> all (array['join_waitlist','submit_feedback'])
  loop
    bad := bad || format('anon can execute SECURITY DEFINER function %s', r.sig);
  end loop;

  if cardinality(bad) > 0 then
    raise exception E'RLS audit (structure): % problem(s)\n  - %', cardinality(bad), array_to_string(bad, E'\n  - ');
  end if;
  raise notice 'rls_audit: structure ok';
end $$;

-- ----------------------------------------------------------------------------- 3. behaviour: seeding
-- Dummy value for a NOT NULL column that has no default, by type.
create function rls_audit.dummy(typ oid, typname text) returns text language plpgsql as $$
declare t pg_type;
begin
  select * into t from pg_type where oid = typ;
  if t.typtype = 'e' then
    return format('%L', (select enumlabel from pg_enum where enumtypid = typ order by enumsortorder limit 1)) || '::' || typname;
  elsif t.typcategory = 'A' then
    return format('%L::%s', '{}', typname);
  end if;
  return case
    when typname = 'uuid'                                  then 'gen_random_uuid()'
    when typname in ('text','character varying','citext')  then '''audit'''
    when typname like 'character(%'                        then '''a'''
    when typname in ('integer','bigint','smallint')        then '1'
    when typname like 'numeric%' or typname in ('real','double precision') then '1'
    when typname = 'boolean'                               then 'false'
    when typname like 'timestamp%' or typname = 'date'     then 'now()'
    when typname in ('jsonb','json')                       then '''{}'''
    when typname = 'interval'                              then '''1 second'''
    when typname = 'bytea'                                 then '''\x00'''
    when typname = 'inet'                                  then '''127.0.0.1'''
    else format('%L', 'audit') end;
end $$;

create table rls_audit.seeded (name text primary key, row_json jsonb not null);

-- Seed one row (owned by A) into public.<tbl>, seeding parents first.
create function rls_audit.seed(tbl text) returns void language plpgsql as $$
declare
  a_id constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  e rls_audit.expect;
  rel regclass := format('public.%I', tbl)::regclass;
  col record;
  cols text[] := '{}';
  vals text[] := '{}';
  fk record;
  v text;
  parent_owner text;
  parent_expr text;
  j jsonb;
begin
  if exists (select 1 from rls_audit.seeded where name = tbl) then return; end if;
  select * into e from rls_audit.expect where name = tbl;

  -- sign-up triggers may already have created A's row (users, subscriptions, ...): use that one
  if e.owner_col is not null then
    execute format('select to_jsonb(t) from %s t where t.%I = %L limit 1', rel, e.owner_col, a_id) into j;
    if j is not null then
      insert into rls_audit.seeded values (tbl, j);
      return;
    end if;
  end if;

  for col in
    select a.attname::text as name, a.atttypid, format_type(a.atttypid, a.atttypmod) as typname,
           a.attnotnull, (d.adbin is not null) as has_default
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity <> 'a'
     order by a.attnum
  loop
    v := null;
    select * into fk from (
      select co.confrelid, (select attname from pg_attribute where attrelid = co.confrelid and attnum = co.confkey[1]) as refcol
        from pg_constraint co
       where co.conrelid = rel and co.contype = 'f' and cardinality(co.conkey) = 1
         and co.conkey[1] = (select attnum from pg_attribute where attrelid = rel and attname = col.name)
    ) f limit 1;

    if e.owner_col = col.name then
      v := format('%L::uuid', a_id);
    elsif exists (select 1 from rls_audit.seed_override o where o.name = tbl and o.col = col.name) then
      select o.expr into v from rls_audit.seed_override o where o.name = tbl and o.col = col.name;
    elsif fk.confrelid is not null and (col.attnotnull or true) then
      if fk.confrelid = 'auth.users'::regclass then
        v := format('%L::uuid', a_id);
      elsif fk.confrelid <> rel and fk.confrelid::regclass::text !~ '^(public\.)?[a-z_]+$' then
        v := null;
      elsif fk.confrelid <> rel then
        parent_owner := fk.confrelid::regclass::text;
        parent_owner := regexp_replace(parent_owner, '^public\.', '');
        if exists (select 1 from rls_audit.expect where name = parent_owner) then
          perform rls_audit.seed(parent_owner);
          select owner_col into parent_owner from rls_audit.expect where name = regexp_replace(fk.confrelid::regclass::text, '^public\.', '');
          execute format('select %I::text from %s %s limit 1', fk.refcol, fk.confrelid::regclass,
                         case when parent_owner is not null then format('where %I = %L', parent_owner, a_id) else '' end)
             into parent_expr;
          if parent_expr is not null then
            v := format('%L::%s', parent_expr, col.typname);
          end if;
        end if;
      end if;
    end if;

    if v is null and col.attnotnull and not col.has_default then
      v := rls_audit.dummy(col.atttypid, col.typname);
    end if;

    if v is not null then
      cols := cols || quote_ident(col.name);
      vals := vals || v;
    end if;
  end loop;

  -- the seeded row must exist and must be A's (or the table's only row if it has no owner column)
  execute format('insert into %s (%s) values (%s) returning to_jsonb(%s)', rel, array_to_string(cols, ','), array_to_string(vals, ','), tbl)
    into j;
  if j is null then
    raise exception 'RLS audit: could not seed %', tbl;
  end if;
  insert into rls_audit.seeded values (tbl, j);
exception when others then
  raise exception 'RLS audit: seeding public.% failed: % [%] -- add a rls_audit.seed_override for it', tbl, sqlerrm, sqlstate;
end $$;

-- ----------------------------------------------------------------------------- 3. behaviour: probes
-- Runs as `who` (anon, or authenticated with uid = b_id) and returns a list of violations.
-- Statements that succeed are rolled back through a sacrificial exception. Only
-- insufficient_privilege (42501: missing grant, or "violates row-level security policy") counts
-- as "blocked"; any other error is reported as inconclusive so the seed can be fixed.
create function rls_audit.probe(who text, tbl text) returns text[] language plpgsql as $$
declare
  a_id constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b_id constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  e rls_audit.expect;
  rel regclass := format('public.%I', tbl)::regclass;
  seed jsonb;
  insert_json jsonb;
  pk record;
  col record;
  w text;
  out text[] := '{}';
  n bigint;
  stmt text;
  claims text;
  ins_cols text;
  upd_stmts text[];
  upd_names text[];
  upd_hits text[] := '{}';
  i int;
begin
  select * into e from rls_audit.expect where name = tbl;
  select string_agg(quote_ident(a.attname), ',' order by a.attnum) into ins_cols
    from pg_attribute a where a.attrelid = rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity <> 'a';
  select row_json into seed from rls_audit.seeded where name = tbl;
  -- No WHERE clause: B owns no rows by now (see the run block), so any row a statement touches
  -- is someone else's. A WHERE on a column would make the statement need SELECT visibility,
  -- which hides a policy that is too broad on UPDATE/DELETE but narrow on SELECT.
  w := '';

  -- a copy of A's row with fresh primary-key values, so a rejected INSERT cannot hide behind a duplicate key
  insert_json := seed;
  for pk in
    select a.attname::text as name, format_type(a.atttypid, a.atttypmod) as typname
      from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = rel and i.indisprimary and a.attname::text is distinct from e.owner_col
  loop
    insert_json := jsonb_set(insert_json, array[pk.name], to_jsonb(case
        when pk.typname = 'uuid' then gen_random_uuid()::text
        when pk.typname in ('integer','bigint','smallint') then (900000000 + (random() * 99999999)::int)::text
        else md5(random()::text) end));
  end loop;

  -- (computed before the role switch: the audited roles cannot see schema rls_audit)
  select array_agg(format('update %s set %I = %s%s', rel, a.attname, rls_audit.dummy(a.atttypid, format_type(a.atttypid, a.atttypmod)), w)
                   order by a.attnum), array_agg(a.attname::text order by a.attnum)
    into upd_stmts, upd_names
    from pg_attribute a
   where a.attrelid = rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity <> 'a';

  claims := case who when 'anon' then '{"role":"anon"}'
              else format('{"sub":"%s","role":"authenticated"}', b_id) end;
  perform set_config('request.jwt.claims', claims, true);
  execute format('set local role %I', who);

  -- SELECT
  if e.kind not in ('public_read') then
    begin
      execute format('select count(*) from %s%s', rel, w) into n;
      if n > 0 then out := out || format('%s: SELECT returned %s of A''s rows from %s', who, n, tbl); end if;
    exception when insufficient_privilege then null;
              when others then out := out || format('%s: SELECT on %s inconclusive: %s', who, tbl, sqlerrm);
    end;
  end if;

  -- UPDATE (every column the role is allowed to touch)
  -- (set to a constant of the column's type; an error other than "permission denied" means a row was reached)
  for i in 1 .. coalesce(cardinality(upd_stmts), 0) loop
    begin
      execute upd_stmts[i];
      get diagnostics n = row_count;
      if n > 0 then upd_hits := upd_hits || upd_names[i]; end if;
      raise exception using errcode = 'P0AUD', message = 'rollback';
    exception when sqlstate 'P0AUD' then null;
              when insufficient_privilege then null;
              when others then upd_hits := upd_hits || (upd_names[i] || ' [then failed: ' || sqlerrm || ']');
    end;
  end loop;
  if cardinality(upd_hits) > 0 then
    out := out || format('%s: UPDATE reached A''s rows in %s (columns: %s)', who, tbl, array_to_string(upd_hits, ', '));
  end if;

  -- DELETE
  begin
    execute format('delete from %s%s', rel, w);
    get diagnostics n = row_count;
    if n > 0 then out := out || format('%s: DELETE removed %s of A''s rows from %s', who, n, tbl); end if;
    raise exception using errcode = 'P0AUD', message = 'rollback';
  exception when sqlstate 'P0AUD' then null;
            when insufficient_privilege then null;
            when others then out := out || format('%s: DELETE on %s inconclusive: %s', who, tbl, sqlerrm);
  end;

  -- INSERT a row owned by A
  begin
    execute format('insert into %1$s (%2$s) select %2$s from jsonb_populate_record(null::%1$s, %3$L::jsonb)', rel, ins_cols, insert_json);
    get diagnostics n = row_count;
    if n > 0 then out := out || format('%s: INSERT of a row owned by A succeeded in %s', who, tbl); end if;
    raise exception using errcode = 'P0AUD', message = 'rollback';
  exception when sqlstate 'P0AUD' then null;
            when insufficient_privilege then null;
            when others then out := out || format('%s: INSERT on %s inconclusive: %s', who, tbl, sqlerrm);
  end;

  reset role;
  return out;
end $$;

-- The same four attempts against a view (SELECT only; writes are checked structurally above).
create function rls_audit.probe_view(who text, vw text) returns text[] language plpgsql as $$
declare
  a_id constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b_id constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  e rls_audit.expect;
  out text[] := '{}';
  n bigint;
begin
  select * into e from rls_audit.expect where name = vw;
  perform set_config('request.jwt.claims',
    case who when 'anon' then '{"role":"anon"}' else format('{"sub":"%s","role":"authenticated"}', b_id) end, true);
  execute format('set local role %I', who);
  begin
    if e.kind = 'view_owner' then
      execute format('select count(*) from public.%I where %I = %L', vw, e.owner_col, a_id) into n;
      if n > 0 then out := out || format('%s: view %s returned %s of A''s rows', who, vw, n); end if;
    elsif e.kind = 'view_blocked' then
      execute format('select count(*) from public.%I', vw) into n;
      out := out || format('%s: view %s (view_blocked) was readable', who, vw);
    end if;
  exception when insufficient_privilege then null;
            when others then out := out || format('%s: view %s inconclusive: %s', who, vw, sqlerrm);
  end;
  reset role;
  return out;
end $$;

-- ----------------------------------------------------------------------------- 3. behaviour: run
do $$
declare
  a_id constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  e rls_audit.expect;
  who text;
  bad text[] := '{}';
  n bigint;
  seeded_total int;
begin
  -- Seed with triggers and foreign keys out of the way (RLS still applies to the audited roles later).
  set local session_replication_role = replica;
  for e in select * from rls_audit.expect where kind in ('owner','public_read','service','insert_only') order by name loop
    perform rls_audit.seed(e.name);
  end loop;
  select count(*) into seeded_total from rls_audit.seeded;

  -- Control 1: the seed is real (superuser sees it) and service_role can read it.
  for e in select * from rls_audit.expect where kind in ('owner','public_read','service','insert_only') order by name loop
    execute format('select count(*) from public.%I', e.name) into n;
    if n = 0 then bad := bad || format('control: no row was seeded in %s', e.name); end if;
    begin
      set local role service_role;
      execute format('select count(*) from public.%I', e.name) into n;
      reset role;
      if n = 0 then bad := bad || format('control: service_role cannot read seeded row in %s', e.name); end if;
    exception when others then
      reset role;
      bad := bad || format('control: service_role cannot read %s: %s', e.name, sqlerrm);
    end;
  end loop;

  -- Control 2: owners can read their own rows (so "others see nothing" is not vacuous).
  for e in select * from rls_audit.expect where kind = 'owner' order by name loop
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', a_id), true);
    begin
      set local role authenticated;
      execute format('select count(*) from public.%I%s', e.name,
                     case when e.owner_col is not null then format(' where %I = %L', e.owner_col, a_id) else '' end) into n;
      reset role;
      if n = 0 then bad := bad || format('control: owner A cannot read their own row in %s (policy or seed is wrong, so the checks on it prove nothing)', e.name); end if;
    exception when others then
      reset role;
      bad := bad || format('control: owner A cannot read %s: %s', e.name, sqlerrm);
    end;
  end loop;

  -- B has a users row (and trigger-made subscriptions etc.) from sign-up. Remove everything B owns so that
  -- any row an attack touches or reads is provably someone else's.
  for e in select * from rls_audit.expect where owner_col is not null and kind in ('owner','public_read','service') loop
    execute format('delete from public.%I where %I = %L', e.name, e.owner_col, 'bbbbbbbb-0000-4000-8000-00000000000b');
  end loop;

  -- The attacks: anon and signed-in user B against A's rows.
  for e in select * from rls_audit.expect where kind in ('owner','public_read','service','insert_only') order by name loop
    foreach who in array array['anon','authenticated'] loop
      bad := bad || rls_audit.probe(who, e.name);
    end loop;
  end loop;
  for e in select * from rls_audit.expect where kind in ('view_owner','view_blocked') order by name loop
    foreach who in array array['anon','authenticated'] loop
      bad := bad || rls_audit.probe_view(who, e.name);
    end loop;
  end loop;

  if cardinality(bad) > 0 then
    raise exception E'RLS audit (behaviour): % problem(s)\n  - %', cardinality(bad), array_to_string(bad, E'\n  - ');
  end if;
  raise notice 'rls_audit: behaviour ok (% tables seeded, anon + authenticated probed)', seeded_total;
end $$;

-- ----------------------------------------------------------------------------- 3b. behaviour: storage.objects
-- Every bucket holds user data (tracks, cover art, avatars, voice samples). Clients must not be able to
-- list or read other users' objects through the API (public buckets are served by direct URL, which
-- does not go through RLS), and must not write any. Only `tracks` has an owner read policy.
do $$
declare
  a_id constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b_id constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  job uuid;
  bkt record;
  who text;
  bad text[] := '{}';
  n bigint;
  oid_ uuid;
  oname text;
begin
  select (row_json ->> 'id')::uuid into job from rls_audit.seeded where name = 'jobs';
  for bkt in select id from storage.buckets order by id loop
    oname := case bkt.id when 'tracks' then job::text || '/audit.bin' else a_id::text || '/audit.bin' end;
    insert into storage.objects (bucket_id, name, owner) values (bkt.id, oname, a_id);
  end loop;

  -- control: the owner reads their own track object (so the checks below are not vacuous)
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', a_id), true);
  set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'tracks';
  reset role;
  if n = 0 then bad := bad || 'control: owner A cannot read their own object in bucket tracks'; end if;

  foreach who in array array['anon','authenticated'] loop
    perform set_config('request.jwt.claims',
      case who when 'anon' then '{"role":"anon"}' else format('{"sub":"%s","role":"authenticated"}', b_id) end, true);
    for bkt in select id from storage.buckets order by id loop
      execute format('set local role %I', who);
      begin
        select count(*) into n from storage.objects where bucket_id = bkt.id;
        if n > 0 then bad := bad || format('%s can list %s objects in bucket %s', who, n, bkt.id); end if;
      exception when insufficient_privilege then null;
                when others then bad := bad || format('%s: SELECT on bucket %s inconclusive: %s', who, bkt.id, sqlerrm);
      end;
      begin
        update storage.objects set metadata = '{}'::jsonb where bucket_id = bkt.id;
        get diagnostics n = row_count;
        if n > 0 then bad := bad || format('%s can UPDATE %s objects in bucket %s', who, n, bkt.id); end if;
        raise exception using errcode = 'P0AUD', message = 'rollback';
      exception when sqlstate 'P0AUD' then null;
                when insufficient_privilege then null;
                when others then bad := bad || format('%s: UPDATE reached bucket %s and failed: %s', who, bkt.id, sqlerrm);
      end;
      begin
        delete from storage.objects where bucket_id = bkt.id;
        get diagnostics n = row_count;
        if n > 0 then bad := bad || format('%s can DELETE %s objects in bucket %s', who, n, bkt.id); end if;
        raise exception using errcode = 'P0AUD', message = 'rollback';
      exception when sqlstate 'P0AUD' then null;
                when insufficient_privilege then null;
                when others then bad := bad || format('%s: DELETE reached bucket %s and failed: %s', who, bkt.id, sqlerrm);
      end;
      begin
        insert into storage.objects (bucket_id, name, owner) values (bkt.id, a_id::text || '/planted.bin', a_id);
        bad := bad || format('%s can INSERT an object into bucket %s', who, bkt.id);
        raise exception using errcode = 'P0AUD', message = 'rollback';
      exception when sqlstate 'P0AUD' then null;
                when insufficient_privilege then null;
                when others then bad := bad || format('%s: INSERT into bucket %s inconclusive: %s', who, bkt.id, sqlerrm);
      end;
      reset role;
    end loop;
  end loop;

  if cardinality(bad) > 0 then
    raise exception E'RLS audit (storage): % problem(s)\n  - %', cardinality(bad), array_to_string(bad, E'\n  - ');
  end if;
  raise notice 'rls_audit: storage ok';
end $$;

rollback;
