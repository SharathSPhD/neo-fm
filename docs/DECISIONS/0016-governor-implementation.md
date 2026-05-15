# ADR 0016 — Governor implementation: file-state + asyncio shutdown

- Status: Accepted (Sprint 6 — neo-fm v1 finish plan)
- Date: 2026-05-15
- Implements: [ADR 0011](0011-governor-and-leases.md)

## Context

ADR 0011 specified the *protocol* between the GPU governor and the
dgx-worker: a JSON file at `/var/run/neo-fm/governor.state` plus
SIGTERM as the hard reclaim signal. This ADR records the *concrete*
implementation choices in Sprint 6.

## Decision

### Worker side: `services/dgx-worker/app/governor.py`

A tiny module with three functions: `read_state`, `write_state`,
`clear_state`. The dataclass `GovernorState` is the typed view:

```python
@dataclass(frozen=True, slots=True)
class GovernorState:
    stop_new_jobs: bool = False
    drain_deadline_ms: int | None = None
    tenant: str | None = None
```

Read failures (missing file, bad JSON, wrong shape, unreadable
deadline) **never raise**. They downgrade to the no-governor default
and log a `WARNING` so operator typos are visible. This satisfies
ADR 0011's "worker must always be able to keep running" requirement.

### Main loop integration

The main loop reads the file at the top of every iteration. If
paused, it sleeps `governor_poll_seconds` (default 2s) and continues
without calling `pgmq.read`. Transitions between paused/resumed and
tenant changes emit one log line each (`governor_paused`,
`governor_resumed`) so the dashboard shows pre-emption events.

### Shutdown propagation

`process_one` accepts an optional `shutdown: asyncio.Event`. When
provided, the inference call runs as one of two racing tasks (the
other being `shutdown.wait()`). If `shutdown` wins:

  1. The inference task is cancelled.
  2. The worker marks the job failed with classification
     `inference_preempted` (ADR 0011 §3).
  3. **No** `pgmq.archive` or `pgmq.delete` is called — the pgmq
     message stays in flight; ADR 0008's lease expiry redelivers it.
  4. The function returns `JobOutcome.FAILED_RETRY`, the main loop
     drains, and the process exits cleanly.

`signal.SIGINT` and `signal.SIGTERM` both set the same `stop` event
that the main loop already used for graceful shutdown — no new
signal-handling code path.

### Operator CLI: `scripts/neo-fm-governor.py`

A 200-line stdlib-only script with four subcommands:

- `pause --tenant <name> --drain-seconds <int>` — writes the state
  file with an embedded drain deadline (unix-ms) for visibility.
- `resume` — removes the state file.
- `status` — JSON snapshot of the state file (for runbook scripting).
- `drain [--dsn ...]` — `pause`, then poll `public.jobs` until no row
  is `processing` (or the deadline fires). Exits 0 on clean drain,
  3 on deadline.

The CLI uses atomic `write+rename` so the worker never reads a
half-written file. Drain's `--dsn` path requires `psycopg`; without
it the command behaves as a `pause` only.

## Tests

`services/dgx-worker/tests/test_governor.py` covers ADR 0011 §6:

- **Gate 1 — drain-respects-in-flight** — flipping the governor flag
  while a job is mid-inference does not abort the job.
- **Gate 2 — drain-deadline-SIGTERM** — setting `shutdown` while the
  inference call hangs cancels it without acking the pgmq message.
- **Gate 3 — `inference_preempted` taxonomy** — the recorded
  classification is `inference_preempted`, not `inference_timeout`.

`scripts/tests/test_governor_cli.py` covers the operator-facing
side: `pause`, `resume`, `status`, and `drain` without a DSN are
unit-tested. `drain --dsn` is exercised in the live smoke harness
because it needs a real Postgres.

## Consequences

- `infra/docker-compose.dgx.yml` adds a host bind-mount of
  `/var/run/neo-fm` so the operator CLI on the host shares state
  with the worker inside the container.
- The pgmq lease-expiry redelivery path is the *only* recovery for
  a SIGTERMed job. ADR 0008's visibility timeout (300s) bounds the
  worst-case latency for a pre-empted song.
- The governor surfaces three new log events the Sprint 7 alert
  pack must learn: `governor_paused`, `governor_resumed`,
  `inference_preempted`.
