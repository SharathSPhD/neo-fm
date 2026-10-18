-- Gift-pack credit inside create_song_job (migration 0090).
--   psql -v ON_ERROR_STOP=1 -f infra/supabase/tests/pack_credit.sql   (database with every migration applied; rolled back)
-- Free tier = 3 songs/month. Asserts: pack credit is untouched while the monthly quota has room, is spent once the
-- quota is used up and the caller opts in (id recorded on the job), is never spent without p_use_pack, is not spent
-- when a capacity check rejects the job, and runs out with quota_exceeded.
begin;
set local client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
values ('cccccccc-0000-4000-8000-00000000000c', 'pack@test.local', '{}', now());

create or replace function pg_temp.new_job(use_pack boolean) returns uuid language plpgsql as $$
declare j uuid;
begin
  select job_id into j from public.create_song_job(
    '{"language":"hi","style_family":"bollywood-ballad","target_duration_seconds":30,"sections":[{"id":"s1","type":"mukhda"}]}'::jsonb,
    'hi', 'bollywood-ballad', 30, 0, null, null, use_pack);
  return j;
end $$;

create or replace function pg_temp.complete(j uuid) returns void language sql security definer as $$
  update public.jobs set status = 'completed', finished_at = now() where id = $1 $$;

create or replace function pg_temp.fails_with(use_pack boolean, want text) returns void language plpgsql as $$
begin
  perform pg_temp.new_job(use_pack);
  raise exception 'FAIL: expected % but the job was created', want;
exception when sqlstate '22023' then
  if sqlerrm not like '%' || want || '%' then raise exception 'FAIL: wanted % got %', want, sqlerrm; end if;
end $$;

create or replace function pg_temp.used() returns int language sql as $$
  select songs_used from public.song_packs where stripe_session_id = 'cs_test_pack' $$;

select public.grant_song_pack('cccccccc-0000-4000-8000-00000000000c', 'cs_test_pack', 'three', 2);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$
declare j uuid; pid uuid; n int;
begin
  -- 1. quota has room: pack opt-in must not spend credit, job has no pack
  j := pg_temp.new_job(true);
  if (select pack_id from public.jobs where id = j) is not null then raise exception 'FAIL: pack spent while quota had room'; end if;
  if pg_temp.used() <> 0 then raise exception 'FAIL: songs_used moved while quota had room'; end if;
  perform pg_temp.complete(j);
  for n in 1..2 loop perform pg_temp.complete(pg_temp.new_job(false)); end loop;   -- quota (3) now used up

  -- 2. exhausted and no opt-in: rejected, no credit spent
  perform pg_temp.fails_with(false, 'quota_exceeded');
  if pg_temp.used() <> 0 then raise exception 'FAIL: credit spent without p_use_pack'; end if;

  -- 3. exhausted and opted in: credit spent once, pack id on the job
  j := pg_temp.new_job(true);
  select id into pid from public.song_packs where stripe_session_id = 'cs_test_pack';
  if (select pack_id from public.jobs where id = j) is distinct from pid then raise exception 'FAIL: pack_id not recorded'; end if;
  if pg_temp.used() <> 1 then raise exception 'FAIL: expected songs_used=1, got %', pg_temp.used(); end if;

  -- 4. a concurrency rejection spends nothing (job from step 3 is still queued, free cap is 1 in flight)
  perform pg_temp.fails_with(true, 'concurrent_cap_exceeded');
  if pg_temp.used() <> 1 then raise exception 'FAIL: credit spent on a rejected job'; end if;

  -- 5. last credit, then none left
  perform pg_temp.complete(j);
  perform pg_temp.complete(pg_temp.new_job(true));
  if pg_temp.used() <> 2 then raise exception 'FAIL: expected songs_used=2'; end if;
  perform pg_temp.fails_with(true, 'quota_exceeded');
  if pg_temp.used() <> 2 then raise exception 'FAIL: credit overspent'; end if;

  raise warning 'pack_credit: PASS';
end $$;

rollback;
