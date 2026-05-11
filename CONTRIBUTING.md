# Contributing

## Prerequisites

- Node 20 (`.nvmrc`).
- pnpm 9 via `corepack enable && corepack prepare pnpm@9 --activate`.
- Python 3.12+.
- [uv](https://github.com/astral-sh/uv) for Python dependency management.
- Docker 25+ with NVIDIA Container Runtime (for DGX-side services).

## First-time setup

```sh
git clone https://github.com/SharathSPhD/neo-fm.git
cd neo-fm
corepack enable && corepack prepare pnpm@9 --activate
pnpm install
```

## Branches

- `main` — always green, always demoable.
- `phase/N-<slug>` — one feature branch per phase or sub-phase (e.g. `phase/1-music-inference`, `phase/4a-supabase-schema`).
- No long-lived branches outside the phase model.

## Worktrees

The recommended workflow is `git worktree` per active phase:

```sh
git worktree add ../neo-fm-phase-1 phase/1-music-inference
cd ../neo-fm-phase-1
```

## Commits

- Conventional-style subject: `phase(N): <short imperative>`. Examples:
  - `phase(0): bootstrap monorepo, docs, contracts, scaffold code`
  - `phase(1): wire HeartMuLa eager load, /v1/generate returns real wav`
- Body explains *why*; the diff already says *what*.

## Phase-gating contract

Before opening a PR for a phase branch, all four must hold:

1. CI green.
2. Containers build and start on the real DGX where applicable.
3. The endpoint returns real, listenable output for one real input.
4. `demos/phase-N.{wav,gif,png,txt}` committed.

See [AGENTS.md](AGENTS.md) for full conventions.

## Common commands

```sh
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build

uv run --project services/music-inference uvicorn app.serve:app --reload
uv run --project services/dgx-worker python -m app.worker
```

## Security

Never commit `.env*`, secrets, or model weights. Use Supabase/Vercel env stores for runtime values.
