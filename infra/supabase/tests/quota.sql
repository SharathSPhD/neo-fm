-- Quota regression test (Sprint 7.1).
--
-- Asserts that public.user_tier_quota(uuid) returns the documented
-- per-tier song-count caps (free=3, creator=25, pro=200).
--
-- Run locally:
--   psql "$SUPABASE_DB_URL" -f infra/supabase/tests/quota.sql
--
-- Run via Supabase MCP (CI / agents): paste the DO block into
-- execute_sql against the target project.
--
-- The script creates three ephemeral auth.users rows (the
-- on_auth_user_created trigger auto-mirrors them into public.users),
-- patches the tier, asserts the quota, and cleans up. A failed
-- assertion `raise exception`s with the tier name, expected, and
-- actual values so CI logs surface the regression cleanly.

do $$
declare
  uid  uuid;
  q    int;
  rec  record;
begin
  for rec in
    select * from (values
      ('free'::public.tier_enum,    3),
      ('creator'::public.tier_enum, 25),
      ('pro'::public.tier_enum,     200)
    ) as t(tier_val, expected)
  loop
    uid := gen_random_uuid();

    -- The on_auth_user_created trigger inserts the matching public.users
    -- row; we just patch the tier afterwards.
    insert into auth.users (id, instance_id, email, aud, role)
      values (
        uid,
        '00000000-0000-0000-0000-000000000000',
        format('qa-%s@neo-fm.test', uid),
        'authenticated',
        'authenticated'
      );
    update public.users set tier = rec.tier_val where id = uid;

    q := public.user_tier_quota(uid);
    if q is distinct from rec.expected then
      -- Clean up before bailing so a failure doesn't leave fixtures.
      delete from public.users where id = uid;
      delete from auth.users   where id = uid;
      raise exception
        'quota_regression: tier=% expected=% got=%',
        rec.tier_val, rec.expected, q;
    end if;

    delete from public.users where id = uid;
    delete from auth.users   where id = uid;
  end loop;

  raise notice 'quota_regression: PASS (free=3 creator=25 pro=200)';
end $$;
