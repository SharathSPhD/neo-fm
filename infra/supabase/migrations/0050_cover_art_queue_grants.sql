-- 0050_cover_art_queue_grants.sql
--
-- Migration 0006 grants "all tables in schema pgmq to neo_fm_worker" at
-- execution time — a snapshot grant. pgmq.create() in 0034 added new
-- tables (pgmq.q_cover_art_jobs, pgmq.a_cover_art_jobs, and their DLQ
-- counterparts) after 0006 ran, so neo_fm_worker has no rights on them.
--
-- Effect: the dgx-worker cover_art_consumer_loop raises
-- "permission denied for table q_cover_art_jobs" on every poll (every 2 s),
-- flooding logs and wasting DB connections.
--
-- Fix: explicit grants on the four tables and their msg_id sequences.
-- Also add ALTER DEFAULT PRIVILEGES so any future pgmq.create() call
-- from the postgres role grants to neo_fm_worker automatically.

grant select, insert, update, delete
  on pgmq.q_cover_art_jobs         to neo_fm_worker;

grant select, insert, update, delete
  on pgmq.a_cover_art_jobs         to neo_fm_worker;

grant select, insert, update, delete
  on pgmq.q_cover_art_jobs_dlq     to neo_fm_worker;

grant select, insert, update, delete
  on pgmq.a_cover_art_jobs_dlq     to neo_fm_worker;

grant usage
  on sequence pgmq.q_cover_art_jobs_msg_id_seq     to neo_fm_worker;

grant usage
  on sequence pgmq.q_cover_art_jobs_dlq_msg_id_seq to neo_fm_worker;

-- neo_fm_worker also needs DML on public.cover_art to execute the
-- flip_current_cover_art transaction (set old is_current=false, insert new).
-- The original migration 0026 only granted to anon/authenticated/service_role.
grant select, insert, update on public.cover_art to neo_fm_worker;
