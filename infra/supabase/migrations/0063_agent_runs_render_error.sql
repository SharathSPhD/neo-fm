-- Keep the real reason a render failed (previously only in a transient trace).
alter table public.agent_runs add column if not exists render_error text;
