# Sprint 3 — Cover-art on DGX (option B)

**Status:** ✅ green
**Branch:** `v1.3-wedge`
**Author:** v1.3 wedge plan (auto)

## What shipped

### Postgres surface (migration 0034)

- New pgmq queues `cover_art_jobs` + `cover_art_jobs_dlq` (idempotent
  `pgmq.create`).
- New table `public.cover_art_attempts` — per-attempt audit row
  (`queued|processing|completed|failed|dlq`, prompt, trace_id,
  model_version, storage_path, error). RLS scoped to the owner of the
  parent `public.jobs` row plus a public/unlisted read policy so the
  share card can render attempt state.
- New RPC `public.enqueue_cover_art_job(p_song_id, p_prompt,
  p_attempt_id, p_trace_id)` — `SECURITY DEFINER`, asserts caller owns
  the song, inserts a `cover_art_attempts` row, and `pgmq.send`s onto
  `cover_art_jobs` in a single transaction. Direct INSERT into
  `cover_art_attempts` is revoked from `authenticated`, so the RPC is
  the only sanctioned ingress (same pattern as `create_song_job`).
- `neo_fm_worker` role granted insert/update on
  `cover_art_attempts` + read/consume on both pgmq queues.

### `services/cover-art-synth` (new FastAPI sidecar)

- Mirror of `services/vocal-synth`: HMAC-signed `POST /v1/generate-cover`,
  `GET /healthz`, `GET /metrics` (Prometheus).
- Three backends behind `COVER_ART_BACKEND`:
  - `z-image` (default) — `tonyassi/z-image-turbo` via `diffusers`.
  - `sdxl-turbo` — fallback, same `_DiffusersBackend` path.
  - `fake` — deterministic radial-gradient renderer, seeded by
    `(prompt, seed, style_family)`. This is what CI runs.
- Model layer lazy-imports `torch`/`diffusers` so unit tests in CI
  never need the diffusion stack. The `dgx` docker stage installs the
  `diffusion` extras; the `ci` stage does not.
- Prometheus surface: `cover_art_requests_total{outcome=}`,
  `cover_art_request_latency_seconds`,
  `cover_art_model_info{model=,version=}`.

### `services/dgx-worker` integration

- `app/cover_art_client.py` (new) — HMAC client to the sidecar,
  mirrors `vocal_client.py` (same signing envelope, same retries).
- `app/cover_art_worker.py` (new) — dedicated `cover_art_consumer_loop`
  that drains `cover_art_jobs`. For each message:
  1. Validate payload (`job_id`, `attempt_id`, `prompt`, `trace_id`).
  2. `UPDATE cover_art_attempts SET status='processing'`.
  3. HMAC-call `services/cover-art-synth` for PNG bytes + model_info.
  4. Upload to Supabase Storage bucket `cover-art` at
     `<user_id>/<song_id>/<attempt_id>.png` with the service role.
  5. Flip `public.cover_art.is_current=false` for any older row, then
     insert a new `cover_art` row with `is_current=true`.
  6. `UPDATE cover_art_attempts SET status='completed', storage_path=,
     model_version=`.
  7. `pgmq.delete`.
  - Retry classification: 4xx from sidecar = non-retryable (mark
    attempt `failed`, `pgmq.delete`); 5xx / transport / storage =
    retryable; after `cover_art_max_attempts` re-deliveries (default
    3), publish to `cover_art_jobs_dlq` and mark attempt `dlq`.
- `app/db.py` — added `update_cover_art_attempt(...)` and
  `flip_current_cover_art(...)` helpers so the worker doesn't need raw
  SQL inline.
- `app/config.py` — new dataclass fields:
  `cover_art_synth_url`, `cover_art_synth_hmac_secret`,
  `cover_art_synth_timeout_seconds`, `cover_art_bucket`,
  `cover_art_queue_name` (`'cover_art_jobs'`),
  `cover_art_dlq_name` (`'cover_art_jobs_dlq'`),
  `cover_art_visibility_seconds`, `cover_art_max_attempts`,
  `cover_art_poll_interval_seconds`. All have defaults so existing
  worker tests keep passing.
- `app/metrics.py` — added
  `cover_art_jobs_total{outcome=completed|failed|dlq|retried}` so
  Grafana dashboards can be wired without code changes.
- `app/worker.py` — main process now spawns the song loop and the
  cover-art consumer concurrently (`asyncio.gather`); a crash in
  either propagates but doesn't silently disable the other.

### Web layer

- `app/api/songs/[id]/cover-art/route.ts` rewritten:
  - `POST` → `supabase.rpc('enqueue_cover_art_job', …)` then returns
    `202 + { attempt_id, status: 'queued', prompt }`. Maps RPC errors:
    `unauthenticated → 401`, `not_owner|song_not_found → 404`,
    `prompt_required|prompt_too_long → 400`, anything else `→ 500`.
    No more HuggingFace inference token. No more direct GPU call from
    Vercel.
  - `GET` → returns `{ url, created_at, attempt: { attempt_id, status,
    error, updated_at } | null }`. `url` is the signed URL of the
    most-recent `is_current=true` artefact (1h TTL); `attempt` is the
    most-recent row in `cover_art_attempts`. The two probes are
    independent — a queued re-roll still shows the existing artwork
    while the new one renders.
- `app/(app)/songs/[id]/cover-art-panel.tsx` polls the GET endpoint
  every 4s while the latest attempt is `queued`/`processing`, swaps in
  the new signed URL when `completed`, surfaces error copy on
  `failed`/`dlq`. Loading spinner overlays the previous artwork so
  there's no "broken image" flash.
- `lib/supabase/database.types.ts` regenerated via
  Supabase MCP `generate_typescript_types` — picks up
  `cover_art_attempts` + the new RPC signature.

### Tests

- `services/cover-art-synth/tests/test_model.py` (5 cases) —
  determinism of `FakeCoverArtModel`, `initialise_from_env` fallback
  to `fake` when diffusion extras aren't installed.
- `services/cover-art-synth/tests/test_serve.py` (9 cases) — `healthz`,
  `/metrics`, HMAC reject (missing header, wrong signature, replay
  window), happy-path PNG generation.
- `services/dgx-worker/tests/test_cover_art_worker.py` (8 cases) —
  happy path (status flips queued→processing→completed, `cover_art`
  row inserted with `is_current=true`, older rows flipped to false,
  pgmq.delete called), invalid payload (skipped, no attempt row
  touched), 4xx from sidecar (`failed`, pgmq.delete, no retry), 5xx
  (retried via visibility timeout, attempt status stays `processing`),
  storage upload failure (treated as retryable), DLQ on max attempts.
- `apps/web/tests/app/api/cover-art.test.ts` (9 cases) — invalid id
  → 400, unauthenticated → 401, song not found → 404, happy path →
  202 with `attempt_id` + prompt that mentions style/raga, RPC error
  mapping (`not_owner` → 404, `unauthenticated` → 401), GET shapes.

## Ralph gate

See [`ralph-evidence.md`](./ralph-evidence.md). All checks pass:

| Check                                                       | Result          |
|-------------------------------------------------------------|-----------------|
| `apply_migration 0034`                                      | green ✅        |
| `enqueue_cover_art_job` RPC present, exec to authenticated  | confirmed ✅    |
| `cover_art_jobs` + DLQ pgmq queues present                  | confirmed ✅    |
| `get_advisors` (security): no new ERROR                     | confirmed ✅    |
| `cover-art-synth` pytest                                    | 14/14 ✅        |
| `dgx-worker` pytest (incl. cover-art consumer)              | 48/48 (1 skip) ✅ |
| Web typecheck + lint + vitest (incl. new cover-art tests)   | 120/120 ✅      |
| `pnpm -r build`                                             | green ✅        |

## Out of scope (carried forward)

- The end-to-end Playwright spec that drives "Re-roll cover" on a
  completed song and waits for the panel to reach `ready` lives in
  Sprint 6's QA sweep — running it from this commit would race the
  rolling Vercel deploy.
- The actual `z-image-turbo` weights download / DGX cache warm-up is
  an operator step; CI exercises the `fake` backend only.
- `services/cover-art-synth`'s SDXL fallback is wired (backend knob +
  same `_DiffusersBackend` codepath) but not exercised in CI.
