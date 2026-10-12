# neo-fm

India-first AI music, built by Technektar. Describe a song in Hindi, Tamil, Telugu, Kannada or Bengali and get original, sectioned lyrics in native script plus a sung track.

- **Lyrics**: the PCE poem cascade (vendored in `managed-agents/pce-engine`) running on Claude Managed Agents, followed by a Sonnet polish pass.
- **Audio**: Google Lyria, with romanized singing script to improve Indic diction.
- **Differentiators**: raga/tala-aware prompts (Carnatic, Hindustani, folk, film, devotional), Indic pronunciation checks, and a pipeline that is safe by construction (moderation before and after generation, AI labelling, atomic spend guard).

Production: web on Vercel (`neo-fm-web`, `main` deploys to production), backend on Supabase project `neo-fm-prod` (ap-south-1), Stripe in test mode.

## Plans

| Plan | Price | Songs / month |
|---|---|---|
| Free | INR 0 | 3 (30 s) |
| Creator | INR 299 | 15 (up to 90 s) |
| Pro | INR 799 | 40 (up to 3 min) |

The pricing page (`apps/web/app/(marketing)/pricing/page.tsx`) is the source of truth for what each plan promises. Quotas live in `user_tier_quota()` (migration 0061); Lyria spend envelopes live in `apps/web/lib/agent/tiers.ts`.

## How a song is made

```
POST /api/songs -> create_song_job (quota and tier checks)
Vercel cron /api/agent/tick (every minute; /api/songs/<id> polling also advances jobs)
  -> claim queued job, take per-job lease
  -> Managed Agent session: PCE cascade -> song document
  -> Sonnet lyric polish -> safety screen -> romanize for diction
  -> Lyria render behind an atomic spend guard (public.reserve_spend)
  -> upload MP3 to Supabase Storage -> Gemini diction QA + telemetry (agent_runs)
```

There is no queue service and no GPU host. A daily cron (`/api/admin/self-improve`) proposes polish-template changes, accepted only when two judge model families agree, with an auto-rollback monitor.

## Repository layout

| Path | What |
|---|---|
| `apps/web` | Next.js 14 App Router app, API routes, agent pipeline (`lib/agent`), safety (`lib/safety`), billing, tests (vitest, Playwright) |
| `managed-agents` | Agent/skill definitions, vendored `pce-engine`, product plan, eval (`EVAL-PCE.md`), economics, cutover runbook |
| `infra/supabase` | Migrations (0001-0063) and prod bootstrap SQL |
| `packages` | Shared TypeScript packages |
| `evals`, `scripts`, `data` | Evaluation briefs, helper scripts, seed data |
| `docs/DECISIONS` | ADRs (early ones describe the DGX design; see the banner in each) |
| `docs/legacy-dgx` | Archived DGX-era status and startup guide |
| `services`, `infra/docker-compose.dgx.yml` | Legacy DGX services, not used in production |

## Read this first

- [AGENTS.md](AGENTS.md): rules for anyone (human or AI) committing here.
- [managed-agents/README.md](managed-agents/README.md): the agent pipeline.
- [managed-agents/PRODUCT-PLAN.md](managed-agents/PRODUCT-PLAN.md): product, pricing and launch plan.
- [managed-agents/CUTOVER.md](managed-agents/CUTOVER.md): production cutover runbook and launch gate.
- [managed-agents/EVAL-PCE.md](managed-agents/EVAL-PCE.md): quality evidence and its limits.
- [STATUS.md](STATUS.md): what works, what is open.

## Local development

```sh
corepack enable && corepack prepare pnpm@9 --activate
pnpm install
pnpm -r typecheck
pnpm --filter @neo-fm/web test        # vitest
pnpm --filter @neo-fm/web dev         # Next.js dev server
pnpm --filter @neo-fm/web test:e2e    # Playwright (the slow create-song journey needs E2E_SLOW)
```

The app needs Supabase, Anthropic (Managed Agents), Gemini/Lyria and Stripe credentials as server-only env vars; see `managed-agents/CUTOVER.md` and `apps/web` for the names. Never commit secrets.

## License

Apache-2.0, see [LICENSE](LICENSE).
