# infra/supabase/migrations

Real SQL migrations land in **Phase 4a** (`phase/4a-supabase-schema` worktree).

Planned migrations (preview):

1. `0001_init.sql` — extensions (`pgcrypto`, `pgmq`), `users`, `subscriptions`.
2. `0002_song_documents.sql` — `song_documents` with `document_json JSONB`, RLS.
3. `0003_jobs_tracks.sql` — `jobs`, `tracks`, RLS, status triggers.
4. `0004_queue.sql` — `select pgmq.create('song_generation_jobs');`

See [docs/SPEC.md](../../../docs/SPEC.md) §5 for the data model and
[docs/DECISIONS/0001-queue.md](../../../docs/DECISIONS/0001-queue.md) for the queue choice.
