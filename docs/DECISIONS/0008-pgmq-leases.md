# ADR 0008: pgmq job leases, retries, and dead-letter handling

Status: Accepted

## Context

ADR 0001 picked `pgmq` over `pg-boss`. `pgmq` is a Postgres extension that
gives queue semantics on top of standard tables. By default it offers
`pgmq.read(queue, visibility_timeout_seconds, qty)` to lease a message and
`pgmq.delete(queue, msg_id)` to ack it. It does **not** include retry,
dead-letter, or per-job heartbeating — those are application concerns.

For neo-fm, a single song job runs for tens of seconds (Phase 1, 30s WAV)
up to several minutes (Phase 6, 90s with full Carnatic arrangement). The
DGX worker can OOM, the GPU can be preempted by an LLM fine-tune (Phase 8
governor), the network to Supabase can blip. Without leases we'd lose work;
without retries the user just sees `failed` for any transient hiccup;
without a DLQ we'd have no way to debug recurring failures.

## Decision

The Phase 4 schema adds the lease/retry/DLQ semantics around the pgmq
primitives:

1. **`jobs.attempts`** (int, default 0): incremented every time the worker
   takes a lease on this job. Visible in `/api/songs/{id}` response.

2. **`jobs.last_attempt_at`** (timestamptz), **`jobs.lease_renewed_at`**
   (timestamptz): set by the worker on lease and renewal.

3. **Visibility timeout**: 5 minutes. The worker calls
   `pgmq.set_vt(queue, msg_id, 300)` every 60s while a job is in flight
   (heartbeat). Missed heartbeats expire the lease, and pgmq makes the
   message visible again to the next poller.

4. **Retry policy**: max 3 attempts. On each `failed` outcome, the worker:
   - sets `jobs.status = 'failed'`, `jobs.error = <classified reason>`,
     `jobs.attempts = jobs.attempts + 1`,
   - **deletes** the message from `pgmq.song_generation_jobs`,
   - if `attempts < 3`, **re-enqueues** with `priority = priority + 10`
     (lower priority on retries) and a delay of `min(60 * 2^attempts, 600)`
     seconds (exponential backoff, capped at 10 min).

5. **Dead-letter queue**: a separate `pgmq.song_generation_jobs_dlq` queue.
   On the third failure, instead of re-enqueueing the main queue, the worker
   pushes to the DLQ with the full error context. Operators inspect DLQ
   contents manually; there is no automated DLQ retry in v1.

6. **Error classification**: the worker maps known failure modes to typed
   `error` strings before writing to `jobs.error`:
   - `inference_oom`
   - `inference_timeout`
   - `inference_http_5xx`
   - `storage_upload_failed`
   - `song_document_invalid` (4xx from validation; not retried — straight to
     DLQ on attempt 1)
   - `unknown`
   Validation failures are **non-retryable**; the worker DLQs immediately.

7. **Idempotency**: the worker writes its result with
   `jobs.attempt_id = uuid_generate_v4()` recorded in the queue message
   (also added to `queue-message.schema.json`). The same `attempt_id`
   appearing twice indicates a bug; tracks insert uses `on conflict do
   nothing` keyed on `(job_id, attempt_id)`.

## Consequences

- Transient failures self-heal within ~10 minutes without operator
  intervention.
- Recurring failures land in a single inspectable place (DLQ) rather than
  silently spamming the user with `failed` notifications.
- A wedged worker doesn't permanently hold a job — visibility timeout
  brings it back into rotation.
- Schema cost: `jobs` table gains `attempts`, `last_attempt_at`,
  `lease_renewed_at`, `attempt_id`. Queue schema gains `attempt_id`,
  `trace_id` (the latter from ADR 0007).
- Operational cost: a small monitoring task (Phase 11) needs to alert on
  DLQ depth growing.
