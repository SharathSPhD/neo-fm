# AGENTS.md — rules for agents working in neo-fm

Read this first. Applies to every agent (human or AI) committing to this repository.

## Phase-gating contract (Ralph-Wiggum promise)

A phase advances iff **all five** hold:

1. **CI green** for `ts`, `py`, `contracts`, and `docker-build` workflows. Where the phase touches DGX behavior, `scripts/dgx-smoke.sh` also passes locally on the DGX (capture its output in `demos/phase-N-bringup.txt`).
2. **Containers build and start on the real DGX** where applicable. The compose stack runs without manual intervention.
3. **Real, listenable output** for at least one real input. Audio is `ffprobe`-verified (non-zero duration, correct sample rate). UI is visually diffed against the spec.
4. **Reproducible demo**: `demos/phase-N.{wav,gif,png,txt}` is committed AND can be regenerated from the merged SHA by running `scripts/build-demo.sh phase-N`. Anyone with the repo can confirm it.
5. **Adversarial review**: a domain reviewer (`ce-adversarial-reviewer` or a phase-specific reviewer such as `ce-correctness-reviewer`, `ce-security-reviewer`, `ce-testing-reviewer`) reviewed the diff. Any blocker findings are either resolved before merge or filed as a fresh ADR under `docs/DECISIONS/`.

No phase merges without all five. No mocks counted as "real". No "I'll add tests later". No "the reviewer is too strict, skip it."

## Worktree workflow

- Each phase gets a feature branch named `phase/N-<slug>` (e.g. `phase/1-music-inference`).
- Work happens in a `git worktree` checked out to that branch.
- Push the worktree branch on every green test run.
- Merge into `main` only when the four-point gating contract is met. Squash merge.
- The `main` branch always has working demos and passing CI.

## Git identity

```sh
git config user.name SharathSPhD
git config user.email ""
```

Empty email is intentional. Do not "fix" it.

## Commit policy

- Conventional-style subject lines: `phase(N): <short imperative>`.
- Use `--allow-empty` only for phase-tag commits.
- Never force-push `main`.

## Code conventions

- **TypeScript**: strict mode. No `any` without an inline rationale comment. Files named `kebab-case.ts`. No inline imports — keep imports at the top.
- **Python**: pydantic v2, type hints everywhere, `ruff` + `mypy --strict` clean. Files named `snake_case.py`.
- **Comments**: explain non-obvious *why*, not what. Do not narrate the code.
- **Docker**: pin base image tags. `nvcr.io/nvidia/pytorch:24.08-py3` for GPU services. Aarch64 (GB10).
- **Secrets**: never commit. Use `.env.local` (gitignored) for local; Supabase/Vercel for deployed.

## Multi-agent orchestration (when applicable)

Spawn parallel subagents for independent work where possible:

- Frontend → `ce-frontend-design`, `nextjs` skill, `react-best-practices`.
- DGX services → `fastapi-pro`, `python-pro`, `ai-engineer`.
- Cloud API + Supabase → `backend-architect`, `supabase` skill.
- Reviews → `architect-review`, `ce-correctness-reviewer`, `ce-code-simplicity-reviewer`.
- Debug → `debugger`, `systematic-debugging` skill.

## TRIZ contradiction handling

When two requirements conflict, log an ADR under `docs/DECISIONS/` and route through the
`contradiction-agent` → `solution-agent` → `evaluator-agent` chain before implementing.

## Stack invariants

- Web: Next.js 14 (App Router), Tailwind, PWA.
- API/Auth/DB/Storage: Supabase (Postgres + RLS + Auth + Storage).
- Queue: pgmq (Postgres extension) — see [docs/DECISIONS/0001-queue.md](docs/DECISIONS/0001-queue.md).
- DGX services: Docker on DGX OS, NVIDIA Container Runtime preinstalled.
- Tunnel: Tailscale (DGX outbound only).
- Models: `m-a-p/HeartMuLa-oss-3B` (Apache 2.0), `kenpath/svara-tts`, AI4Bharat Indic-TTS.

v1 scope: web only; styles `{Western, Carnatic, Hindustani, Kannada-folk}`; langs `{en, hi, kn}`; durations `{30s, 60s, 90s, 3min}`. No payments. No MCP exposure.
