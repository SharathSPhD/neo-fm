# neo-fm status

> **Current handoff: [docs/HANDOFF.md](docs/HANDOFF.md)** (2026-10-12). Parts of this file predate it; where they disagree, HANDOFF.md wins.

*Updated 2026-10-12, against `main` at 4ea78a5. Claims come from the code and docs in this repo; nothing here was re-measured against production.*

## Product

India-first AI music (Technektar). Native-script lyrics from the PCE cascade on Claude Managed Agents, sung by Google Lyria. Plans: Free (3 songs/month), Creator INR 299 (15), Pro INR 799 (40). Stripe is in test mode. See [README.md](README.md) for the pipeline and layout.

## What works

- End-to-end Managed Agents + Lyria jobs, verified on dev for Hindi, Kannada and Tamil with ffprobe-checked audio (see `managed-agents/PRODUCT-PLAN.md`).
- Spend safety: atomic `reserve_spend`, per-user monthly Lyria caps by tier (`lib/agent/tiers.ts`), render claims counted in the DB.
- Safety: deterministic and Haiku moderation before and after generation (fails closed), report button, trust/grievance page, AI labelling.
- Quality eval: 150-brief blind eval, PCE+polish beats best-of-6+polish 87-41 (Claude judge) and 87-50 (Gemini judge). Negative results are recorded in `managed-agents/EVAL-PCE.md`; the marketing claim is bounded to what that supports.
- Diction: the romanized singing script lowered Gemini-measured character error rate from 4.6% to 1.1% on 6 Kannada/Tamil/Telugu/Hindi clips (source: comment in `apps/web/lib/diction/romanize.ts`; small sample). Current per-language pronunciation match is in `managed-agents/QUALITY-REPORT.md`.
- Self-improvement: daily polish-template proposals gated on two-family judge agreement, with auto-rollback.
- Tests: vitest unit tests (`apps/web/tests`) and Playwright specs (`apps/web/tests/e2e`); CI jobs for `ts`, `agents` and `pce-engine`. Counts change often, so run the suites for current numbers.

## Open issues

| Area | Issue |
|---|---|
| Latency | Pro jobs take about 12 minutes. Owned by the pipeline session. |
| Rate limiting | In-memory only; Upstash not provisioned. |
| Quality | Prosody is the weak dimension (-0.24 vs baseline). Kannada evidence is weakest. Telugu diction varies. No native-speaker panel yet, so no stronger claims. |
| Cost | Lyria cost per song is estimated, not measured from billing. Margins (~50%) are modeled. |
| Observability | Per-job telemetry in `agent_runs`; no dashboard or alerting on failure rate, spend vs ceiling, queue age or diction match. |
| Worker | A single Vercel cron tick is the whole worker. A stuck lease (280 s) or a plan limit delays every job. |
| Prod hygiene | Test users (e.g. a pro-tier e2e bot) exist in prod; keys shared in chat during development must be rotated before launch. |
| Tests | The slow create-song e2e runs only under `E2E_SLOW`; no automated check that cron tick and poll do not double-advance a job. |
| Legacy | `services/*`, `infra/docker-compose.dgx.yml` and `.github/workflows/docker-build.yml` still describe the retired DGX path. |

## Launch blockers (waiting on the owner)

Supabase Pro, Resend key and repointing the migration 0029 email trigger (it still targets the old project), Stripe webhook and live mode, domain nameservers, grievance mailbox and officer name, counsel review of /privacy and /terms, DPDP deletion/export flow, `CRON_SECRET` rotation. The full gate is in [managed-agents/CUTOVER.md](managed-agents/CUTOVER.md).

## Database

Supabase project `neo-fm-prod`, `managed-agents/CUTOVER.md` records which migrations are applied (verify against Supabase before relying on it); the repo's migrations are numbered through 0070 (some numbers are unused, e.g. 0020, 0064, 0069). Check open PRs for the next free number before adding one.

## History

The first version of neo-fm ran generation on an NVIDIA DGX Spark (HeartMuLa, svara-TTS, pgmq worker). That path is retired; its status and startup guide are archived in [docs/legacy-dgx](docs/legacy-dgx).
