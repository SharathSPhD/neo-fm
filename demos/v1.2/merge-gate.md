# Merge gate — v1.2-bugfix-pack → main

**Status**: GREEN. Merged and live in production.

## Git

| | |
| --- | --- |
| Feature branch | `v1.2-bugfix-pack` |
| Merge commit | `1047186` (`v1.2-bugfix-pack: bugfix + paid + polish (Sprints 1-8)`) |
| Strategy | `--no-ff` |
| Target | `origin/main` |
| Pushed | yes |

## Vercel auto-promotion

| | |
| --- | --- |
| Deployment | `dpl_86ZM7UmgcUcRoqXY6wiY7T9CmEyd` |
| URL | `neo-fm-9h5pfnrsm-ss-projects-f08e52ab.vercel.app` |
| Aliases | `neo-fm-web.vercel.app`, `neo-fm-web-ss-projects-f08e52ab.vercel.app`, `neo-fm-web-git-main-ss-projects-f08e52ab.vercel.app` |
| Target | production |
| State | READY |
| Region | iad1 |

## Post-merge production re-smoke

- `/api/health`: `status=ok`, `version=v1.2-bugfix-pack`, `commit=1047186`, supabase 50ms
- Full 11-surface walkthrough (see `demos/v1.2/sprint-merge-resmoke/`): 12/12 green
- Playwright e2e suite: 13/13 green in 41.1s

## Phase gates closed

| Phase | Gate | Closed at |
| --- | --- | --- |
| 1 | typecheck/lint/tests green; song-create works on dev + prod | sprint-1, sprint-2 |
| 2 | email round-trip succeeds for e2e-smoke@neo-fm.test | sprint-3 |
| 3 | research doc renders, top-3 features confirmed | sprint-4 |
| 4 | Free user upgrades to Creator via test card, quota flips 3 → 25 | sprint-5c |
| 5 | each polish feature has vitest + Playwright smoke | sprint-6 |
| 6 | all suites green, axe critical/serious = 0, Lighthouse targets met | sprint-7 |
| final | typecheck + lint + test sweep, supabase advisors clean, prod health ok | sprint-7-9 |
| merge | v1.2-bugfix-pack → main, push, Vercel auto-promotion, re-smoke prod | this commit |

## Ralph promise

Honored across all 8 sprints + 7 phase gates: no sprint shipped without
the prior gate being green, no merge happened without the final gate
being met, no claim of "done" without artefact under `demos/v1.2/`.
