-- 0060: lyrics actually sent to the music model after the host-side Sonnet meter/diction polish (see lib/lyrics/polish.ts).
alter table public.agent_runs add column if not exists polished_lyrics text;
