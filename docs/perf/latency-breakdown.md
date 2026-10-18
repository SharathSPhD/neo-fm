# Pro latency: baseline and plan to under 4 minutes

Status: baseline from total job latency only (per-stage timings land with the lead's instrumentation in `lib/agent/process.ts`, written to `job_telemetry.metrics.stages_ms`). Regenerate with `ADMIN_TOKEN=… node scripts/latency-breakdown.mjs --base <host> --plan pro` or `select * from stage_latency_summary(now() - interval '7 days', 'pro')` (migration 0067).

## Baseline (neo-fm-prod, all jobs to date, 2026-10-12, 31 incl. 4 failed, `started_at` to `finished_at`)

| Cohort | Jobs | Median | Range |
|---|---|---|---|
| Free (K=3, no QA) | 13 | 3.4 min | 2.2 to 4.5 min (two outliers ~18 min) |
| Pro, quiet (one or two in flight) | 8 completed | 7.8 min | 6.3 to 15.5 min |
| Pro, burst (10 jobs submitted 16:38 to 16:55) | 10 completed | ~41 min | 11 to 55 min |

- Queue wait (`created_at` to `started_at`) is 2 to 26 s everywhere. It is not the problem.
- Everything after start is one opaque number today. Only `lyria_calls` (always 1) and `diction_match_pct` are recorded besides the total.
- No 60 s Pro song is in the sample (`target_s` is 30 or 90), so 60 s must be interpolated or measured once stage timings exist.
- Pro runs 4 to 6 minutes slower than Free at the same target length. Pro adds K=6, the Sonnet coordinator, the Opus/Sonnet polish pass, and the Gemini diction QA.
- The burst cohort is a throughput problem, not a per-job one: jobs serialise behind `CONCURRENCY`, the 280 s lease, and a once-a-minute cron.

## Stage definitions (from the lead's PR #28, `metrics.stages_ms`, flat milliseconds)

`queue_wait` (created to started), `agent_draft` (start to the tick that first sees `generate_music`; tick granularity, so plus or minus 60 s), `polish`, `lyria` (wall time incl. retries), `upload`, `post_render` (render answered to agent idle), `finalize`, `qa`. Stages not observed are omitted. The view and script are key-agnostic, so they pick these up unchanged.

## Where the time can go (hypotheses to confirm with `stages_ms`)

1. Tick granularity. `advance()` is called once per cron minute (`vercel.json`) or by the song poll route. Each state change (session start, tool call answered, outcome graded) can wait up to a minute. A pipeline with ~6 hand-offs loses ~3 min here regardless of model speed.
2. Managed Agent session: sandbox start, K=6 drafting, `cascade_audit.json`, outcome grading.
3. Polish: one Sonnet call with a template fetch, plus a second safety screen. Serial before Lyria.
4. Lyria render: scales with target length (the code notes a 60 s request produced ~170 s of audio and the render is a single blocking call).
5. Upload and finalize, then QA. QA runs after `finished_at` so it does not count toward user latency but holds the lease.

## Plan (ordered by expected win; each needs a measured stage number before and after)

| # | Change | Why | Owner |
|---|---|---|---|
| 1 | Loop `advance()` inside one invocation until it returns `waiting` on a real external wait (poll every 2 to 3 s up to the lease), instead of one step per cron minute | Removes up to ~1 min per hand-off. Expected largest single win | lead (`lib/agent/*`) |
| 2 | Start polish as soon as the lyrics file exists and overlap it with the style-prompt/diction-hint build; skip the second screen when the polish diff is empty | Takes polish off the critical path where it can be | lead |
| 3 | Cap Pro drafting at K=6 but run drafters concurrently and stop at the first committed candidate with delta_F above threshold | Cuts agent time with no quality change at the committed threshold | lead / agent definitions |
| 4 | Move `qaDiction` out of the job lease (fire after `finished_at`, separate tick) | No user-latency change, frees the worker for the next job in a burst | lead |
| 5 | Raise `CONCURRENCY` and shorten lease handling so a burst does not serialise (the 41 min cohort) | Fixes the tail rather than the median | lead, needs ops sign-off |
| 6 | Re-measure at `target_s=60` on Pro after 1 to 3, using real Lyria renders | Confirms the <4 min claim at the product's real length | needs lead approval for spend |

Target: median Pro 60 s song under 4 min, p90 under 6 min, burst of 10 under 10 min. The honest status today is: median ~7.8 min quiet, p90 ~15 min, burst ~41 min.

## Not done here
- No Lyria renders were run. Step 6 needs the lead to approve spend against the shared GBP 8 cap.
- No edits to `apps/web/lib/agent/*`; instrumentation is the lead's.
