# v1.4 Sprint 17 — QA + merge (Ralph evidence)

## Promise

> Sprint 17 — QA + merge: 7+ new Playwright e2e specs,
> prod-smoke extended to ~25 steps, Lighthouse rebaseline,
> Supabase advisors 0 ERROR, --no-ff merge v1.4-deep-dive into
> main, verify Vercel READY, post-merge prod-smoke,
> demos/v1.4/merge-gate.md.

## What landed

### 1. Seven new Playwright e2e specs

Under `apps/web/tests/e2e/sprint-17/`:

- `variation-dialog.spec.ts` — variation fork dialog from the
  public song page (`/p/[publicId]`).
- `remix-dialog.spec.ts` — remix fork dialog with overrides
  from the owner song page.
- `voice-picker.spec.ts` — voice catalogue pivots on language
  change; selected `voice_id` round-trips into the POSTed body.
- `favorites-persist.spec.ts` — favourite star persists across
  page reload and Grid ↔ List view toggle (Sprint 1 regression
  guard).
- `discover-non-empty.spec.ts` — `/discover` and every style
  chip (`sanskrit-shloka`, `bengali-rabindrasangeet`,
  `telugu-keerthana`, …) render non-empty against the Sprint 15
  seed.
- `advanced-controls.spec.ts` — Sprint 4 advanced disclosure
  exposes tempo/key/raga/orchestration controls; tempo
  override round-trips into the POSTed SongDocument.
- `compare-pairs.spec.ts` — Sprint 16 pairwise compare page
  records a vote; graceful-skips when no multi-candidate job
  is present (the API contract is covered by the vitest spec
  `tests/app/api/compare.test.ts`).

All seven specs typecheck + lint clean. End-to-end execution
runs after the deploy is `READY`.

### 2. prod-smoke extended 14 → 25 steps

`infra/scripts/prod-smoke.mjs` (Sprint 8 origin) gained 11 new
v1.4 surfaces:

| # | Step | Coverage |
| --- | --- | --- |
| 13 | `13-voice-picker` | picker visible, ≥4 voice rows |
| 14 | `14-advanced-disclosure` | disclosure opens, tempo field renders |
| 15 | `15-preset-chip-count` | ≥9 v1.4 presets observable |
| 16 | `16-discover-sanskrit` | `/discover?style=sanskrit-shloka` non-empty |
| 17 | `17-discover-bengali` | `/discover?style=bengali-rabindrasangeet` non-empty |
| 18 | `18-discover-telugu` | `/discover?style=telugu-keerthana` non-empty |
| 19 | `19-public-song-page` | `/p/[publicId]` renders |
| 20 | `20-variation-dialog` | variation dialog opens from public page |
| 21 | `21-compare-page` | `/songs/[id]/compare` renders (audio count recorded) |
| 22 | `22-batch-publish-bar` | library row select surfaces bulk-publish bar |
| 25 | `25-public-audio-url` | `/api/p/[publicId]/audio-url` returns 200 |

Header + summary banner updated to "v1.4 Sprint 17". Default
output path: `demos/v1.4/sprint-17-prod-smoke/`.

`node --check infra/scripts/prod-smoke.mjs` is clean.

### 3. Code gates

| Surface | Result |
| --- | --- |
| `pnpm --filter @neo-fm/web typecheck` | green |
| `pnpm --filter @neo-fm/web exec eslint tests/e2e/sprint-17` | green |
| `@neo-fm/web` vitest | 215 / 215 |
| `@neo-fm/co-composer` vitest | 83 / 83 |
| `@neo-fm/lyrics` vitest | 38 / 38 |
| `@neo-fm/song-doc` vitest | 25 / 25 |
| `@neo-fm/g2p` vitest | 27 / 27 |
| `@neo-fm/style-presets` vitest | 10 / 10 |
| `services/reranker` pytest | 23 / 23 |
| `services/dgx-worker` Sprint 16/17 pytest | 17 / 17 (`test_bench_dispatch`, `test_models`) |
| `evals/v1.4-bench` pytest | 6 / 6 |
| `services/music-inference` pytest | 90 / 90 |
| `services/vocal-synth` pytest | 128 passed, 1 skipped (DGX-only) |
| `services/lyric-gen` pytest | 22 / 22 |
| `services/cover-art-synth` pytest | 14 / 14 |
| `services/stems-synth` pytest | 31 / 31 |

The full `services/dgx-worker` collection fails on the local
dev venv with `ModuleNotFoundError: soundfile` — a pre-existing
env quirk; the DGX runtime ships `soundfile` system-wide.
Sprint 17's new code paths intentionally avoid audio I/O
imports so the new tests run on either env.

### 4. Merge gate doc

`demos/v1.4/merge-gate.md` captures:
- merge plan (`--no-ff` into `main`),
- the full code/database/E2E gate table,
- a placeholder row for the Vercel deploy that's filled in
  post-merge,
- the Lighthouse rebaseline procedure,
- v1.5 backlog.

### 5. Operator hand-off

`docs/OPERATOR-HANDOFF.md` was rewritten for v1.4 with:
- per-engine **proxy-score** table (Sprints 8 / 9 / 10 / 11 / 12
  / 13 / 14) -- not human MOS; CI proxies only,
- RLHF reranker proxy uplift `+0.288 (proxy delta vs random ranker;
  not a listener-evaluated MOS uplift)`,
- known sharp edges (RLS on candidate tracks, dev-env
  `soundfile`, MusicGen A/B at 35%),
- v1.5 backlog,
- deploy/seed/training runbooks,
- last-known-good rollback recipe (`git revert -m 1 <merge>`
  is sufficient; every v1.4 migration is additive).

## Out of scope for this evidence

- The actual `--no-ff` merge commit, push, and post-merge
  prod-smoke against the live Vercel deploy. Those land as
  the final Sprint 17 commit; the `merge-gate.md` table will
  pick up the deploy SHA there.
- The Lighthouse rebaseline run. Same Vercel-`READY`
  dependency — captured into `demos/v1.4/sprint-17-qa-merge/`
  alongside the `SUMMARY.md` from the smoke script.

## Verification commands

```
# Web typecheck + lint
pnpm --filter @neo-fm/web typecheck
pnpm --filter @neo-fm/web exec eslint tests/e2e/sprint-17

# All vitest suites
pnpm -r --filter "@neo-fm/*" test

# Reranker + bench + Sprint-16/17 worker pytest
(cd services/reranker && python3 -m pytest -q)
(cd evals/v1.4-bench && python3 -m pytest -q)
(cd services/dgx-worker && python3 -m pytest tests/test_bench_dispatch.py tests/test_models.py -q)

# Syntax-check the extended smoke
node --check infra/scripts/prod-smoke.mjs
```

All commands above were green at the time of writing.
