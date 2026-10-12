-- Post-render diction audit (Gemini transcription vs intended lyrics), stored per run and shown on the song page.
alter table public.agent_runs add column if not exists diction_qa jsonb;
