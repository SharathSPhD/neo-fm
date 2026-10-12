# AGENTS.md: rules for agents working in neo-fm

Read this first. Applies to every agent (human or AI) committing to this repository. For what the product is and how it is built, read [README.md](README.md) and [STATUS.md](STATUS.md).

## Merge contract

A change merges only when:

1. **CI is green** on the PR head (`ts`, `agents`, `pce-engine` in `.github/workflows/ci.yml`; `e2e` where it applies).
2. **The lead session has reviewed it.** The lead Claude session reviews and merges on S's behalf; S is not asked to review each PR. Other agents open PRs (draft by default), send the link to the lead session, handle its review comments, and never merge themselves. `main` deploys to production on Vercel, so merging is a release.
3. **Evidence for behavior changes**: tests that fail without the change, or a listenable/visible artifact for audio and UI work. No mocks presented as "real" results, no "tests later".
4. **Claims stay honest.** Quality or marketing claims must stay inside what `managed-agents/EVAL-PCE.md` supports (AI judges, no native-speaker panel yet, prosody behind baseline).

## Branches and commits

- Work on a feature branch (`claude/<slug>` for agent work); open a PR against `main`. Never force-push `main`.
- Short imperative subject lines, optionally prefixed by area (`docs:`, `ux:`, `agent:`). Squash merge.
- Git identity for commits made on S's behalf:

```sh
git config user.name SharathSPhD
git config user.email qbz506@york.ac.uk
```

Vercel deploy protection blocks commits whose author email is unrecognised, so use the GitHub-verified address above.

## Hard boundaries

- **Secrets**: never commit them, never paste them into PRs, issues or chat. Server-only env vars live in Vercel and Supabase. Rotate anything that has appeared in logs or chat before launch.
- **Production**: do not change prod env vars, apply migrations to `neo-fm-prod`, or run cleanup against prod data without S's explicit go. Prepare scripts and migrations in the PR and list the S-owned step.
- **Migrations**: sequential, next number after the highest in `infra/supabase/migrations`. Check open PRs and branches first to avoid collisions.
- **Spend**: Lyria and Claude calls cost money. Go through the existing guards (`reserve_spend`, tier caps in `apps/web/lib/agent/tiers.ts`); never bypass them or loop paid calls in tests.
- **Safety**: moderation fails closed. Do not weaken `apps/web/lib/safety`, and do not add voice cloning, artist imitation or copyrighted-lyric reproduction.
- **Ownership**: if another session or PR owns a path (for example `apps/web/lib/agent/*`), coordinate instead of editing it.

## Code conventions

- **TypeScript**: strict mode. No `any` without an inline rationale. Files are `kebab-case.ts`. Imports at the top of the file, no inline imports.
- **Python** (the `pce-engine` vendor and legacy services): type hints, `ruff` clean. Files are `snake_case.py`.
- **Comments** explain non-obvious *why*, not what.
- Match the surrounding code's style, naming and comment density.

## Before opening a PR

```sh
pnpm install
pnpm -r typecheck
pnpm -r --if-present lint
pnpm --filter @neo-fm/web test
```

Docs-only changes still need CI to pass. Prices, quotas and model names in docs must match the code (`pricing/page.tsx`, `user_tier_quota()`, `lib/agent/tiers.ts`).

## Stack

- Web: Next.js 14 App Router, Tailwind, PWA, on Vercel.
- Data and auth: Supabase (Postgres, RLS, Auth, Storage). Project `neo-fm-prod`.
- Lyrics: Claude Managed Agents (`managed-agents/`), PCE engine, Sonnet polish. Audio: Google Lyria.
- Worker: Vercel cron `/api/agent/tick` each minute; no queue service, no GPU host.
- Billing: Stripe (test mode until launch).

## Legacy DGX material

The original design ran HeartMuLa, svara-TTS and a pgmq worker on an NVIDIA DGX Spark, with phase gates and a "local compute only" rule. That is retired. The code remains in `services/`, `infra/docker-compose.dgx.yml` and early ADRs under `docs/DECISIONS/`; the old status and startup guide are in [docs/legacy-dgx](docs/legacy-dgx). Do not extend it or apply its rules to new work. New ADRs go in `docs/DECISIONS/`.
