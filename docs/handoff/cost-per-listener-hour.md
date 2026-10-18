# Cost per listener-hour (estimate)

**This is an estimate, not billing data.** Inputs are the code's per-render rate and the 2026-10-18 test renders in `ops/lyria-cost.md` (Google billing was not reachable) and `ops/spend.md` (Claude billed USD 0.00 in the window; app ledger unavailable). Recompute once the Lyria ledger and Supabase egress show real numbers.

## Inputs

| Input | Value | Source |
|---|---|---|
| Lyria full render | GBP 0.25 per render (`LYRIA_COST_GBP_FULL`) | code default; 10 test renders = GBP 2.50 estimated |
| Typical track | about 62 s, about 1.5 MB mp3 (about 195 kbps) | 6 of 10 test renders; long ones ran 85-89 s and 2.0-2.1 MB |
| FX | USD 1.30 per GBP | `ops/spend.md` |
| Storage egress | USD 0.09 per GB at overage; Supabase plans include a monthly egress quota that may cover early traffic | Supabase list price, assumption |
| Claude per personal track (lyrics + polish) | about GBP 0.10 | handover estimate |

One listener-hour is 3600 s of audio: about 58 tracks, about 87 MB.

## Table

| Mode | What is paid | Per listener-hour (GBP) | Per listener-hour (USD) |
|---|---|---|---|
| Pool playback (shared tracks, already rendered) | Storage egress only: 0.087 GB x USD 0.09 | about 0.006 | about 0.008 (zero while inside the plan quota) |
| Personal layer (every track freshly rendered) | 58 x (0.25 Lyria + 0.10 Claude) | about 20 | about 26 |
| Mixed station, 10% personal | 90% pool + 10% personal | about 2.0 | about 2.6 |
| Mixed station, 5% personal | 95% pool + 5% personal | about 1.0 | about 1.3 |

Pool tracks are rendered once and played many times, so their render cost is amortised across listeners: a 130-track pool costs about GBP 32.5 in Lyria once (130 x 0.25).

## What it means

- A pool-only listener is nearly free; the personal layer is about 3,000x more expensive per hour. The mix ratio is the whole cost model.
- At the approved prices (gift song INR 99, 3-pack INR 249), one personal song earns far more than its GBP 0.35 cost, so personal tracks sold individually are fine; an unmetered "personal" hour would not be.
- A station pass needs a cap on personal renders per month (see `lib/agent/tiers.ts`) rather than an hourly promise.

## Caveats

- Lyria may bill by output length; long renders (85-89 s) may cost more than the flat rate.
- Claude per-track figure is the handover estimate; the eval gate ran about 1.8x over its estimate.
- Egress excludes Vercel bandwidth if audio is proxied rather than served from Supabase signed URLs.
