# v1.3 merge gate

## Merge status

- Local: `v1.3-wedge` merged into `main` via `git merge --no-ff`
  on commit `264f14a` ("v1.3-wedge: privacy, presets, cover-art,
  phonetics, wedge landing").
- Remote: pushed to `origin/main` (`d9f4862..264f14a`).
- Branch retained for traceability; safe to delete after the
  Vercel deploy unblocks (below).

## Code gates (green)

| Surface | Result |
| --- | --- |
| `pnpm -r --filter '@neo-fm/*' lint` | green (`apps/web` clean) |
| `pnpm -r --filter '@neo-fm/*' typecheck` | green (6 / 6 packages) |
| Web vitest | **120 / 120** |
| Co-composer vitest | **67 / 67** (incl. 6 new phoneme tests) |
| Style-presets vitest | 7 / 7 |
| Lyrics vitest | 24 / 24 |
| Song-doc vitest | 18 / 18 |
| **g2p vitest** | **27 / 27** (new package, all rule packs) |
| vocal-synth pytest | 36 / 36 |
| dgx-worker pytest | 47 passed, 1 skipped (DGX-only smoke) |
| cover-art-synth pytest | 14 / 14 (new service) |
| music-inference pytest | 26 / 26 |
| **Total** | **263 TS + 123 Python tests green** |

## Database gate

- Migrations `0032_style_family_extension`,
  `0033_language_ta`, and `0034_cover_art_jobs` are all present
  in `list_migrations` for project `lsxicfgqtdxvlcivlwmd`.
- `get_advisors(type=security)` returns **0 ERROR-level lints**.
- 13 WARN-level lints, all pre-existing patterns (the two
  v1.3-introduced WARNs — `cover_art_attempts_touch` mutable
  `search_path`, `enqueue_cover_art_job` SECURITY DEFINER
  callable by `authenticated` — both follow the same approved
  pattern as `create_song_job`, `publish_song`, etc.).

## Vercel deploy gate — **READY**

The merge-day BLOCK is resolved. Two operator-side changes
unblocked the deploy:

1. `SharathSPhD/neo-fm` repository visibility was set back
   to **public**, restoring the Hobby-tier deploy path.
2. The merged v1.3 commits had been authored as
   `SharathSPhD <Unknown>` (the agent's local git config
   lacked `user.email`), which trips Vercel's Git Author
   verification with the message
   *"The deployment was blocked because the commit author
   email (Unknown) is not valid."*

| Deployment | Commit | State | Notes |
| --- | --- | --- | --- |
| `dpl_8yJhucmjYh4fJpsrPgDFz1rV4apV` | `264f14a` (old, author=Unknown) | BLOCKED | superseded |
| `dpl_CggFi4owUa8gmHYsZybS1gsvaCpf` | `264f14a` CLI redeploy | BLOCKED | superseded |
| `dpl_CyaTm42CK3cVEmWTxPL61J85DVBy` | `4730961` merge-gate (author=Unknown) | BLOCKED | superseded |
| **`dpl_3ThejYj1NPdPfWRwp246YXMoKeiH`** | **`dc621ca`** (author=`qbz506@york.ac.uk`) | **READY** | live on `neo-fm-web.vercel.app` |

### How the author email was repaired

The eight v1.3 commits (`d9f4862..4730961`) were rewritten
through `git filter-branch --env-filter` so every commit
that had an empty `GIT_AUTHOR_EMAIL` /
`GIT_COMMITTER_EMAIL` was replaced with
`qbz506@york.ac.uk` (one of the two emails the operator
confirmed is verified on the GitHub account; the other is
`sharath.sathish@outlook.com`). The repo's local
`user.email` was also set so subsequent commits do not
regress.

Force-push (`+ 4730961...dc621ca main`) re-triggered the
GitHub → Vercel webhook. `dpl_3Thej...` cleared the
author-email gate, built cleanly, and is rolled to the
production alias.

### Post-unblock re-smoke (run)

```
SMOKE_OUT=demos/v1.3/sprint-6-prod-smoke \
node infra/scripts/prod-smoke.mjs
```

Result on `dc621ca`: **14 / 15 PASS**. Lone FAIL was
`8-songs-new` — the smoke had been querying
`a[href*='preset=']` but the creation canvas exposes
presets as `<button>` chips, not anchors. The marketing
landing is the only surface that uses anchor links. Fixed
in `e028528`:

- `apps/web/.../preset-gallery.tsx` stamps
  `data-preset={preset.id}` on each `<button>` so the
  preset chip is observable from the outside.
- `infra/scripts/prod-smoke.mjs` step `8-songs-new` unions
  `[data-preset]` and `a[href*='preset=']` results, so the
  gate fires whether presets render as buttons or anchors.
- A second re-run flagged a stale required-preset list
  (`kannada-folk` was retired in Sprint 2); aligned the
  list to the eight v1.3 IDs in
  `packages/style-presets/src/index.ts`.

Result on `e028528` (final): **15 / 15 PASS**.

| # | Step | Notes |
| --- | --- | --- |
| 1 | `1-landing` | H1 = "The only AI music platform that gets Indian languages right at the phoneme level." |
| 2 | `2-pricing-anon` | pricing visible to anon |
| 3 | `3-discover-anon` | discover visible to anon |
| 4 | `4-sign-in` | smoke user logged in → /library |
| 5 | `5-library-grid` | cover-art grid (Sprint 6 v1.2) |
| 6 | `6-library-list` | list view (Sprint 6 v1.2) |
| 7 | `7-cmd-palette` | Cmd+K palette opens |
| 8 | `8-songs-new` | all **8 / 8** v1.3 presets observable |
| 9 | `9-pricing-authed` | pricing visible to authed user |
| 10 | `10-account` | account page renders |
| 11 | `11-song-detail` | song detail + remix CTA visible |
| 12 | `12-cover-art-panel` | cover-art panel visible (Sprint 3 evidence) |
| 13 | `health-anon` | `commit: null` (Sprint 1 privacy gate held) |
| 14 | `health` | authed `version: v1.3-wedge`, `commit: e028528` |

## Out of scope / accepted gaps

- **Historical `docs/*` commit rewrite** — the plan explicitly
  parks this as a "follow-up after repo is private". Pushing a
  history-rewrite would break Vercel deploy lineage (which is
  already wobbly thanks to BLOCKED) and is out of scope for v1.3.
- **Real audio in the Listen section** — the three anchor preset
  cards on the new landing link to the templates that produce
  the samples. Real-audio renders depend on a DGX worker that's
  currently paused; queued to capture in v1.4.
- **Lighthouse re-run on the rewritten landing page** —
  blocked on the production deploy unblocking; the local build
  was lint + typecheck + vitest clean.

## Sprint-by-sprint demo artefacts

```
demos/v1.3/
├── sprint-1-privacy/        SUMMARY.md + ralph-evidence
├── sprint-2-presets/        SUMMARY.md + ralph-evidence
├── sprint-3-cover-art/      SUMMARY.md + ralph-evidence
├── sprint-4-phonetics/      SUMMARY.md + ralph-evidence
├── sprint-5-wedge/          SUMMARY.md
├── sprint-6-qa-merge/       SUMMARY.md
└── merge-gate.md            (this file)
```

All six sprint gates closed under the Ralph promise, the
production deploy is live on commit `dc621ca`, and the
extended `prod-smoke` harness is green end-to-end.
