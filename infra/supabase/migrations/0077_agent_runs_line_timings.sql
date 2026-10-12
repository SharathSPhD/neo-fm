-- Per-line start/end seconds for synced lyrics (see managed-agents/LINE-TIMINGS.md). Written best-effort after the diction audit.
alter table public.agent_runs add column if not exists line_timings jsonb;
