-- Per-job worker lease so the cron tick and the pull-based poll never advance one job concurrently.
alter table public.jobs add column if not exists agent_lease_until timestamptz;
