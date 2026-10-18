-- recover_song_job enqueues on the real worker queue (migration 0091).
--   psql -v ON_ERROR_STOP=1 -f infra/supabase/tests/recover_queue.sql   (database with every migration applied; rolled back)
-- Before 0091 the retry went to pgmq queue 'q_song_jobs', which no migration creates, so recover raised and rolled back.
-- Asserts: recover of a failed job succeeds, the job is queued with a new attempt id, exactly one new message lands on
-- song_generation_jobs carrying the keys the enqueue wrapper requires, and q_song_jobs is still not a queue.
begin;
set local client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
values ('dddddddd-0000-4000-8000-00000000000d', 'recover@test.local', '{}', now());

create or replace function pg_temp.set_status(j uuid, st public.job_status_enum) returns void language sql security definer as $$
  update public.jobs set status = st where id = $1 $$;

create or replace function pg_temp.queue_count() returns int language sql security definer as $$
  select count(*)::int from pgmq.q_song_generation_jobs $$;
create or replace function pg_temp.last_message() returns jsonb language sql security definer as $$
  select message from pgmq.q_song_generation_jobs order by msg_id desc limit 1 $$;
create or replace function pg_temp.old_queue_exists() returns boolean language sql security definer as $$
  select exists (select 1 from pgmq.meta where queue_name = 'q_song_jobs') $$;

create or replace function pg_temp.add_run(j uuid, audio text) returns void language sql security definer as $$
  insert into public.agent_runs (job_id, session_id, status, lyria_calls, audio_path)
  values ($1, 'sesn_test', 'failed', 1, $2) $$;
create or replace function pg_temp.has_run(j uuid) returns boolean language sql security definer as $$
  select exists (select 1 from public.agent_runs where job_id = $1) $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-4000-8000-00000000000d","role":"authenticated"}', true);

do $$
declare j uuid; old_attempt uuid; new_attempt uuid; before_n int; after_n int; msg jsonb;
begin
  select job_id into j from public.create_song_job(
    '{"language":"hi","style_family":"bollywood-ballad","target_duration_seconds":30,"sections":[{"id":"s1","type":"mukhda"}]}'::jsonb,
    'hi', 'bollywood-ballad', 30);
  select attempt_id into old_attempt from public.jobs where id = j;
  perform pg_temp.set_status(j, 'failed');

  before_n := pg_temp.queue_count();
  select attempt_id into new_attempt from public.recover_song_job(j);
  after_n := pg_temp.queue_count();

  if after_n <> before_n + 1 then raise exception 'FAIL: expected one new message on song_generation_jobs, got %', after_n - before_n; end if;
  if new_attempt is null or new_attempt = old_attempt then raise exception 'FAIL: recover did not issue a new attempt id'; end if;
  if (select status::text from public.jobs where id = j) <> 'queued' then raise exception 'FAIL: job not queued after recover'; end if;

  msg := pg_temp.last_message();
  if msg->>'job_id' <> j::text or msg->>'attempt_id' <> new_attempt::text
     or msg->>'style_family' <> 'bollywood-ballad' or (msg->>'target_duration_seconds')::int <> 30
     or msg ? 'trace_id' is not true or msg ? 'song_document_id' is not true then
    raise exception 'FAIL: recover payload wrong: %', msg;
  end if;
  if pg_temp.old_queue_exists() then raise exception 'FAIL: q_song_jobs should not exist'; end if;

  -- A failed job keeps an agent_runs row (session set, status failed). Recover must clear it when there is no audio,
  -- otherwise advance() would return "done" and the retry would fail again at once.
  perform pg_temp.set_status(j, 'failed');
  perform pg_temp.add_run(j, null);
  perform public.recover_song_job(j);
  if pg_temp.has_run(j) then raise exception 'FAIL: audio-less agent_runs row survived recover'; end if;

  -- ...but a run that already has audio is kept.
  perform pg_temp.set_status(j, 'failed');
  perform pg_temp.add_run(j, 'tracks/test.mp3');
  perform public.recover_song_job(j);
  if not pg_temp.has_run(j) then raise exception 'FAIL: agent_runs row with audio was deleted'; end if;

  raise warning 'recover_queue: PASS';
end $$;

rollback;
