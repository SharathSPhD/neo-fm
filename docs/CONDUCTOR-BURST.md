# Conductor burst capacity: simulation findings

Simulation: `apps/web/tests/sim/` (`npx vitest run tests/sim`). It runs the real `advance()` with mocked agent sessions and Lyria on a virtual clock, and re-implements only the scheduling around it (claim cap, batch concurrency, lease, 300 s function deadline) from `lib/agent/process.ts`. No network, no spend. Latencies are assumptions calibrated so one quiet Pro job is ~7 min; they are not measurements.

## What the simulation shows

| Scenario (10 Pro jobs at once) | p50 | max | failed |
|---|---|---|---|
| quiet, 1 job | 6.9 m | 6.9 m | 0 |
| current policy, provider unconstrained | 8.9 m | 10.9 m | 0 |
| current, provider runs 4 sessions at once | 12.9 m | 18.9 m | 0 |
| current, provider runs 2 sessions at once | 18.9 m | 30.9 m | 0 |
| current, render takes 150 s | 9.9 m | 11.9 m | **3** |
| claim-all + worker pool(8) | 6.9 m | 7.9 m | 0 |

1. **Our scheduling alone explains only about +4 minutes** (3 claims per tick, batches of 4). It does not reproduce 41 min. The rest of the observed slowdown must come from outside the tick: provider-side session capacity (slots=2 already gives ~31 min) and/or render time. Worth confirming with `stages_ms` from job_telemetry for the burst jobs (agent_draft vs render vs post_render).
2. **Real defect: slow renders lose songs.** `processJobs` runs jobs in fixed batches of 4 with `Promise.all`; a batch waits for its slowest job. With renders around 150 s, the second batch's render outlives the 300 s function deadline, the result is dropped, the lease is never released, and `claimRender` already consumed the only slot. The next tick's retry is refused ("render limit reached"), so the agent finishes without audio and the job fails. 3 of 10 jobs fail in the simulation. A sliding worker pool removes this because no job waits behind a batch.
3. **Fairness:** with the provider as the constraint (slots=4, 15 free jobs ahead of 5 Pro), FIFO makes Pro wait p50 21.9 m while free finishes in 9.9 m. Weighted aging (score = tier weight x time waited, pro 3 / creator 2 / free 1) gives Pro p50 6.9 m and free 18.9 m, and a long-waiting free job still overtakes fresh Pro work, so free is not starved.

## Proposed fixes (changes to `lib/agent/process.ts`, lead-owned; not made here)

1. Claim all queued jobs per tick (or a high cap such as 25) instead of `MAX_CLAIM = 3`. Gate total in-flight sessions by a configured provider limit instead.
2. Replace the batch barrier with a sliding worker pool of 8 (`CONCURRENCY`), so one slow render never blocks others.
3. Order both claiming and advancing by weighted aging across tiers.
4. Stop the lost-render failure: take the render slot as "reserved with a timestamp" and let `claimRender` hand the slot back when the previous holder's lease has expired and no audio was stored (needs a migration; ask the lead for a number), or start renders only when at least ~120 s of the function budget remains.
5. Move the render itself out of the tick (per-job invocation via `waitUntil`/queue) so tick length stops capping render time. Larger change; only if 1 to 4 are not enough.

## Caveats

- The owner's poll route also calls `processJobs(env, jobId)`, which bypasses the claim cap for watched songs; unwatched burst jobs (scripts, telemetry runs) see only the cron path simulated here.
- Provider capacity is modelled as N concurrent sessions; the real limit is unknown.
