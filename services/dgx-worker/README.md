# services/dgx-worker

DGX-side worker that polls the pgmq queue, calls `music-inference`, uploads to Supabase Storage, and updates job rows.

## Phase 0 (now)

Print-loop stub that logs "Phase 0 stub: pgmq client not wired yet" once per cycle and sleeps. Useful for `docker compose up` and CI build verification.

## Phase 4 (next)

- `psycopg` client connects to Supabase Postgres.
- `pgmq.read('song_generation_jobs', vt=300, qty=1)` per cycle.
- Validates message body against [`docs/contracts/queue-message.schema.json`](../../docs/contracts/queue-message.schema.json).
- Fetches full Song Document from `song_documents` table by `song_document_id`.
- POSTs to `music-inference` `/v1/generate`.
- PUTs the resulting WAV to Supabase Storage via signed URL.
- Updates `jobs` row with status + `track` row with final URL.
- `pgmq.archive(...)` on success.

## Phase 8

`nvidia-smi`-aware throttling. Music-inference capped at ≤50% GPU. Priority queue lets LLM fine-tune workloads preempt.
