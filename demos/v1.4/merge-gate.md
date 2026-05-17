# v1.4 merge gate

## Merge status

- Local: `v1.4-deep-dive` queued for `git merge --no-ff` into `main`
  after Sprint 17 closes (this file is the gate doc).
- Worktree: `/home/sharaths/projects/neo-fm-worktrees/v1.4-deep-dive`
  off `main@e028528`.
- Branch retained for traceability; safe to delete after the
  Vercel deploy is `READY`.

The `--no-ff` merge mirrors the v1.3 cadence so the v1.4 sprint
arc shows up as a single merge commit on `main`, with the 17
sprint commits visible underneath it.

## Code gates (green)

| Surface | Result |
| --- | --- |
| `pnpm -r --filter '@neo-fm/*' lint` | green |
| `pnpm -r --filter '@neo-fm/*' typecheck` | green |
| `@neo-fm/web` vitest | **215 / 215** |
| `@neo-fm/co-composer` vitest | 83 / 83 |
| `@neo-fm/lyrics` vitest | 38 / 38 |
| `@neo-fm/song-doc` vitest | 25 / 25 |
| `@neo-fm/g2p` vitest | 27 / 27 |
| `@neo-fm/style-presets` vitest | 10 / 10 (incl. 3 new v1.4 presets) |
| `services/vocal-synth` pytest | 128 passed, 1 skipped (DGX-only) |
| `services/music-inference` pytest | 90 / 90 |
| `services/lyric-gen` pytest | 22 / 22 |
| `services/cover-art-synth` pytest | 14 / 14 |
| `services/stems-synth` pytest | 31 / 31 |
| `services/reranker` pytest | **23 / 23** (new Sprint 16 service) |
| `services/dgx-worker` Sprint 16/17 pytest | **17 / 17** (`test_bench_dispatch`, `test_models`) |
| `evals/v1.4-bench` pytest | **6 / 6** (new Sprint 16 harness) |
| **Total** | **~398 TS + ~321 Python tests green** |

The full `services/dgx-worker` suite (mixer/worker/governor/vocal)
collects with `ModuleNotFoundError: soundfile` on the dev Python
venv but the DGX runtime ships `soundfile` system-wide; see
`docs/DECISIONS/0023-dgx-only-training-inference.md`. Sprint
17 deliberately leaves this dev-only env quirk untouched: the
new code paths (Sprint 16 `bench_dispatch`, `top_n_candidates`)
are covered by tests that don't import audio I/O.

## E2E (Playwright) gates

Sprint 17 added seven new specs to `apps/web/tests/e2e/sprint-17/`:

- `variation-dialog.spec.ts`
- `remix-dialog.spec.ts`
- `voice-picker.spec.ts`
- `favorites-persist.spec.ts`
- `discover-non-empty.spec.ts`
- `advanced-controls.spec.ts`
- `compare-pairs.spec.ts` (graceful-skip when no multi-candidate
  job is present; the API contract is covered by the vitest
  spec `tests/app/api/compare.test.ts`)

All seven specs typecheck + lint clean. End-to-end execution
runs after the deploy is `READY` (Playwright drives the live
Vercel build, not the local dev server).

## Database gate

- Migrations new in v1.4: 0035 through 0041 are all present in
  `list_migrations` for project `lsxicfgqtdxvlcivlwmd`.
- `get_advisors(type=security)` returns **0 ERROR-level lints**.
- WARN-level lints follow approved patterns from v1.3 and
  earlier (`SECURITY DEFINER` + `authenticated`-callable for
  `publish_song_batch`, `record_preference_pair`).

Notable v1.4 migrations:

| Migration | Purpose | Sprint |
| --- | --- | --- |
| `0035_voice_catalog.sql` | 16-persona voice catalogue table | 5 |
| `0036_indic_corpus_audit.sql` | corpus rows audit + RLS | 6 |
| `0037_user_presets.sql` | per-user advanced preset jars | 4 |
| `0038_reserved` | (skipped — reserved for late-Sprint-7 add) | — |
| `0039_published_visibility.sql` | published_visibility column on `jobs` | 15 |
| `0040_publish_song_batch.sql` | `publish_song_batch` SECURITY DEFINER RPC | 15 |
| `0041_preference_pairs_and_candidates.sql` | RLHF preference pairs + `tracks.candidate_index/is_current` | 16 |

## Vercel deploy gate

To be filled in once the merge commit pushes to `origin/main`:

| Deployment | Commit | State | Notes |
| --- | --- | --- | --- |
| `dpl_PLACEHOLDER` | `MERGECOMMIT` | _pending_ | live on `neo-fm-web.vercel.app` |

Repeat the v1.3 author-email check before pushing the merge
commit: `git log -1 --format='%an %ae'` on the merge commit
must resolve to a Vercel-verified email; the operator's
verified emails are `qbz506@york.ac.uk` (primary) and
`sharath.sathish@outlook.com`. The repo's local `user.email`
was set in v1.3 so subsequent commits inherit it.

## Post-merge prod-smoke

`infra/scripts/prod-smoke.mjs` was extended from 14 → **25
steps** in Sprint 17, adding coverage for the voice picker,
advanced controls, v1.4 style filters on `/discover`, the
public song page, the variation dialog, `/songs/[id]/compare`,
the library batch-publish bar, and `/api/p/[publicId]/audio-url`.

```
SMOKE_OUT=demos/v1.4/sprint-17-prod-smoke \
node infra/scripts/prod-smoke.mjs
```

To be re-run against the merge-commit deploy; the `SUMMARY.md`
written into `demos/v1.4/sprint-17-prod-smoke/` is the
post-merge gate artefact.

## Lighthouse rebaseline

Same procedure as v1.3 — run from a fresh Chromium against the
`READY` deploy alias once the merge clears Vercel. Baseline
target: `Performance ≥ 90` on `/` and `/discover` (anon), `≥
85` on `/library` (authed); regressions vs v1.3 baseline must
be triaged before declaring the gate green.

## Out of scope / parked for v1.5

(Aligned with the plan's "Out-of-scope for v1.4" section.)

- Script→performance corpus (R2 §8) — v1.6+.
- MusicGen-Large upgrade — v1.5 backlog.
- NeMo TTS rolled out to a second language — v1.5 backlog.
- Expanded chant corpus + multi-deity raga prosody — v1.5 backlog.

## Sprint-by-sprint demo artefacts

```
demos/v1.4/
├── sprint-0-preflight/         ralph-evidence.md
├── sprint-1-foundation-bugs/   ralph-evidence.md
├── sprint-2-song-doc-schema/   ralph-evidence.md
├── sprint-3-fork-dialog/       ralph-evidence.md
├── sprint-4-bg-music-ux/       ralph-evidence.md
├── sprint-5-voice-catalog/     ralph-evidence.md
├── sprint-6-indic-corpus/      ralph-evidence.md
├── sprint-7-lyric-gen/         ralph-evidence.md
├── sprint-8-bhavageete-lora/   ralph-evidence.md
├── sprint-9-tamil-folk-lora/   ralph-evidence.md
├── sprint-10-musicgen-adapter/ ralph-evidence.md
├── sprint-11-stems-transitions/ralph-evidence.md
├── sprint-12-indicf5/          ralph-evidence.md
├── sprint-13-nemo-kannada/     ralph-evidence.md
├── sprint-14-chant/            ralph-evidence.md
├── sprint-15-discover/         ralph-evidence.md
├── sprint-16-rlhf/             ralph-evidence.md
├── sprint-17-qa-merge/         (this gate's evidence — added with the merge commit)
└── merge-gate.md               (this file)
```

All 17 sprint gates closed under the Ralph promise. The merge
commit is the single rollback boundary into v1.3 if any
post-deploy probe goes red.
