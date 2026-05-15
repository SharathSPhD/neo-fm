# services/dgx-worker

DGX-side worker that polls the pgmq queue, calls `music-inference`, uploads to Supabase Storage, and updates job rows. **Implemented and live in production** — a real job (`ce972419-60fc-40a7-b2d5-10287e465a15`) has closed the loop in ~39 s.

## What it does, in order

1. Connects to Supabase Postgres via `psycopg` using the dedicated [`neo_fm_worker`](../../infra/supabase/migrations/0006_worker_role.sql) role (least-privilege; column-level `UPDATE` grants only on `public.jobs` lifecycle columns; `BYPASSRLS` matches `service_role` per migration `0010`).
2. `pgmq.read('song_generation_jobs', vt=300, qty=1)` per cycle (ADR 0001).
3. Validates the message body against [`docs/contracts/queue-message.schema.json`](../../docs/contracts/queue-message.schema.json) (`QueueMessage` Pydantic model).
4. CAS-claims `public.jobs` (`status='queued' → 'processing'`, increments `attempts`, sets `attempt_id`). Stale leases get reclaimed safely (ADR 0008).
5. Runs a heartbeat task in the background that calls `pgmq.set_vt(...)` and updates `public.jobs.lease_renewed_at` every 60 s while the job is in flight (ADR 0008 §3).
6. Fetches the full Song Document from `public.song_documents` by `song_document_id`.
7. Builds an HMAC-signed `GenerateRequest` (ADR 0003 — body + timestamp signed with `MUSIC_INFERENCE_HMAC_SECRET`) and POSTs to `music-inference` `/v1/generate`.
8. Streams the returned WAV bytes to Supabase Storage via `POST /storage/v1/object/tracks/<job_id>/<attempt_id>.wav`. The new opaque `sb_secret_*` API keys require **both** the `apikey` header and a matching `Authorization: Bearer` (Storage gateway parses bearer as a Compact JWS otherwise). See [tests/test_storage.py](tests/test_storage.py).
9. Inserts a `public.tracks` row idempotent on `(job_id, attempt_id)`.
10. Marks `public.jobs.status='completed'`, sets `finished_at`, and `pgmq.archive(...)` the message. On failure, classifies the error per ADR 0008 §6 (`inference_timeout`, `inference_http_4xx`, `inference_http_5xx`, `inference_network_error`, `storage_upload_failed`), then either re-enqueues with a fresh `attempt_id` or DLQs after `max_attempts`.

## Local development

```sh
uv sync --group dev
uv run pytest -q
```

Tests use [`tests/fakes.py`](tests/fakes.py) (`FakeWorkerDB`, `FakeStorageClient`, `FakeInferenceClient`) so the suite runs without Supabase, Storage, or music-inference being reachable. The end-to-end smoke test against live Supabase is `scripts/e2e-smoke.py` at the repo root.

## Run on the DGX

```sh
docker compose -f infra/docker-compose.dgx.yml --env-file infra/.env.dgx up -d dgx-worker
docker compose -f infra/docker-compose.dgx.yml --env-file infra/.env.dgx logs -f dgx-worker
```

Env vars are documented in [`infra/.env.dgx.example`](../../infra/.env.dgx.example).

## Coming in Phase 8 (per ADR 0011)

The worker becomes governor-aware: a filesystem state file at `/var/run/neo-fm/governor.state` lets the GPU governor signal `stop_new_jobs` cooperatively. The worker observes the flag between jobs (never mid-job), heartbeats survive cooperative pauses, and SIGTERM exits without acking so pgmq lease expiry handles the redelivery. New error class `inference_preempted` distinguishes governor pre-emption from `inference_timeout`. ADR 0011 §5 has the protocol pseudocode; ADR 0011 §6 has the three required test gates.
