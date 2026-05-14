# ADR 0011: GPU governor — lease semantics across pre-emption

Status: Proposed (design-only; blocks Phase 8 implementation)

## Context

Phase 8 ([SPEC §3.8][SPEC], [IMPLEMENTATION_PLAN §Phase 8][PLAN]) introduces
the GPU governor: a process on DGX that schedules music inference against
other GPU consumers (LLM fine-tunes, eval runs, voice synth from Phase 7).
The governor's primary job is to **pause** the music-inference worker when
a higher-priority tenant arrives and **resume** it afterwards.

[SPEC]: ../SPEC.md
[PLAN]: ../IMPLEMENTATION_PLAN.md

[ADR 0008][ADR8] already established job leases for `dgx-worker`:

[ADR8]: 0008-pgmq-leases.md

- A pgmq message is visible-timed-out for 300s.
- The worker heartbeats `pgmq.set_vt(queue, msg_id, 300)` every 60s while
  a job is in flight.
- Missed heartbeats expire the lease; another worker picks up the job.

This creates a direct contradiction with a naïve "stop the process" governor:

| Scenario                                                  | Result without coordination                  |
| --------------------------------------------------------- | -------------------------------------------- |
| Governor SIGSTOPs the worker for 120s mid-job             | Heartbeat skipped → lease expires (>300s? no, but if pause >300s yes) → duplicate execution |
| Governor kills `music-inference` container for 60s        | Worker sees `inference_network_error` → retries → re-runs same generation on a different message |
| Governor drains the GPU for an hour-long fine-tune        | All in-flight leases expire → DLQ fills with `inference_timeout` errors |

The contradiction (C-governor): we want the governor to *take the GPU back
quickly* (no waiting for a 30–90s song to finish) AND we want lease-driven
exactly-once execution (no duplicate generations, no spurious DLQs).

## Decision

Phase 8 ships only after this ADR is accepted. The governor must be
**lease-aware**; the worker must be **pause-aware**. Two coordination
primitives are added:

### 1. Pre-empt before SIGSTOP/kill: ask the worker to pause cooperatively

The governor never freezes a running music-inference job mid-flight. Its
only knobs are:

a. **Stop accepting new jobs.** The governor sets a flag (filesystem
   marker, env var refresh, or admin endpoint — implementation detail
   for Phase 8) that the worker reads at the top of each `process_one()`
   iteration. While set, the worker keeps heartbeating any in-flight
   job but does **not** call `pgmq.read()` for new ones.

b. **Drain.** The governor waits for the in-flight job to finish (or hit
   ADR 0008's 5-min visibility timeout in the worst case) before
   reclaiming the GPU. Drain has a configurable deadline (default 120s
   wall-clock); on deadline the governor falls through to (c).

c. **Hard reclaim.** Only if drain deadline passes, the governor SIGTERMs
   the worker. The worker's signal handler **does not** ack the pgmq
   message and **does not** mark the job failed. The lease will expire
   naturally; ADR 0008 retry semantics handle the rest. The error
   classification recorded *if* the lease comes back to the same worker
   is `inference_preempted` (new taxonomy entry — see §3 below).

### 2. Heartbeat survives the pause window

Inside the worker's `process_one()`, the heartbeat loop runs on a
separate thread (or asyncio task) decoupled from the inference call, so
that:

- A long inference doesn't accidentally stall the heartbeat.
- A paused inference (governor flag `stop_new_jobs=true` while the
  current job continues) keeps refreshing `pgmq.set_vt` and
  `jobs.lease_renewed_at` regardless.

The heartbeat thread terminates only when (a) the job completes, (b) the
job is acked into terminal state (ready / failed / DLQ), or (c) the
process receives SIGTERM. On SIGTERM, the heartbeat thread exits
*without* renewing the lease — explicit "I am no longer the owner" —
which lets another worker reclaim immediately rather than waiting for
the 300s VT to time out.

### 3. ADR 0008 taxonomy gains `inference_preempted`

Adding to ADR 0008 §6:

- `inference_preempted` — the governor reclaimed the GPU before the job
  completed. Retried like a transient `inference_http_5xx`: stays on
  the main queue, attempts counter increments, normal backoff.

This is intentionally separate from `inference_timeout`. `_timeout` is
the model itself taking too long; `_preempted` is an operator action.
Mixing them would obscure governor-induced churn in observability.

### 4. Worker-side composability with ADR 0008 §3 (heartbeat at 60s)

If the worker has been told to stop accepting new jobs and the in-flight
job is still running, the heartbeat continues at 60s. This means a
4-minute song that overlaps with a 2-minute LLM fine-tune blocks the
fine-tune from starting until the song finishes (or drain deadline
fires).

This is *correct*. The governor's drain deadline lets the operator
choose whether to wait or to pre-empt; the worker's heartbeat keeps the
existing job intact while the choice is being made. ADR 0008 is not
modified by Phase 8; ADR 0011 simply layers on top.

## Consequences

### Positive

- Governor and lease semantics compose without either of them needing
  to know the other's internal state.
- The default behavior is "finish the current song, then yield the
  GPU" — the user-visible behavior most aligned with the product
  promise (don't ruin a song someone is waiting on).
- Hard pre-emption is still available for cases where the user wait is
  preferable to delaying a higher-priority workload.
- `inference_preempted` makes governor-driven retries first-class in
  observability rather than masquerading as `inference_timeout`.

### Negative / costs

- Drain deadline tuning becomes an operator concern. 120s is reasonable
  for Phase 1 (30s songs) but too short for Phase 6 (≥60s songs);
  Phase 8 implementation should expose it via env config.
- A new heartbeat threading path in `dgx-worker` increases worker
  complexity. Must be covered by a test that simulates a long-running
  inference and verifies the lease never expires while the worker is
  alive.
- `inference_preempted` adds a taxonomy entry that downstream
  observability (Phase 11) must learn — the ADR is the contract.

### Operational

- Phase 8 implementation work is unblocked, but cannot begin until this
  ADR is moved to Accepted and the Phase 8 plan references it.
- A test of the form "governor sets `stop_new_jobs`, in-flight song
  completes, lease never expires, second job is picked up after the
  flag is cleared" is a required Phase 8 gate.

## Out of scope

- The governor's scheduling policy itself (priority order, fair share,
  long-running tenant detection). Phase 8 implementation decision.
- Multi-host coordination — Phase 8 is single-DGX. If we ever run two
  DGXes, the lease semantics inherited from ADR 0008 still hold; the
  governor just becomes per-host.
- Voice-synth integration (Phase 7) competes for the same GPU. Phase 7
  must register with the governor like any other tenant; that contract
  is captured in Phase 7's own implementation, not here.
