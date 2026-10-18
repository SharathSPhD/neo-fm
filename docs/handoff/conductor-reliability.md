# Handoff: conductor reliability

## State (all merged via #30)
- `apps/web/lib/agent/sweeper.ts`: fails a `processing` job only if it is >30 min old, its `agent_runs.updated_at` is >20 min stale, it has no audio and no live lease. It takes the job lease (compare-and-set), re-reads the run under it, then fails the job with code `timed_out` and releases a leaked Lyria reservation into the job's start month. Runs at the top of `/api/agent/tick`.
- `apps/web/lib/agent/circuit-breaker.ts`: per-process Lyria breaker (3 outage-class failures -> open, 60s cooldown doubling to 5 min, one half-open probe). `advance()` takes `gate`/`gateRelease`; `process.ts` wires `lyriaBreaker`.
- Tests: `tests/agent-chaos.test.ts`, `tests/lyria-breaker.test.ts`, `tests/sim/conductor-load.test.ts` (virtual-clock burst simulation), route tests under `tests/app/api/`.
- Docs: `docs/RUNBOOK.md` (ops, CRON_SECRET rotation), `docs/CONDUCTOR-BURST.md` (burst findings). `scripts/check-audio-integrity.mjs` is a read-only storage/DB checker.
- Also in #30: embed-path security headers, song DELETE storage cleanup.

## Run and verify locally
```
pnpm install --frozen-lockfile
pnpm --filter @neo-fm/song-doc --filter @neo-fm/co-composer --filter @neo-fm/style-presets --filter @neo-fm/lyrics build
cd apps/web && npx vitest run && npx tsc --noEmit -p .
node scripts/check-audio-integrity.mjs --help   # read-only; needs service env, never run against prod without the operator
```

## Open risks
1. Conductor pool (#68) bounds concurrency per tick, not globally; overlapping ticks can run many renders at once against one Lyria key. Add a cap on live leases.
2. No start deadline in `runJob`: jobs started near the 300s limit are killed mid-run and keep their lease for 280s.
3. `agent_runs.updated_at` is only touched on state changes, so a long drafting job can look idle to the sweeper (20 min window). Have `advance()` touch the row.
4. A worker whose lease already expired but is still running is not protected from the sweeper.
5. The breaker is per process, not fleet-wide.

## Next 3 steps
1. Global lease cap and start deadline in `processJobs` (lead-owned file).
2. `advance()` bumps `agent_runs.updated_at` each step.
3. Fix `tests/app/api/billing-checkout.test.ts` "reuses an existing customer" once #45 is on main (`stripe.subscriptions.list` is not mocked there).

No secrets in this document.
