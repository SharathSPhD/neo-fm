# v1.3 Sprint 6 — Full QA sweep + production smoke + merge

Same shape as v1.2's Sprint 7+8+merge gate.

## QA sweep (all green on the `v1.3-wedge` branch, commit `bb62054`)

### TypeScript / web

```
$ pnpm -r --filter '@neo-fm/*' lint
  apps/web lint: ✔ No ESLint warnings or errors

$ pnpm -r --filter '@neo-fm/*' typecheck
  packages/g2p typecheck: Done
  packages/song-doc typecheck: Done
  packages/co-composer typecheck: Done
  packages/lyrics typecheck: Done
  packages/style-presets typecheck: Done
  apps/web typecheck: Done

$ pnpm -r --filter '@neo-fm/*' test
  packages/style-presets:  7 / 7
  packages/lyrics:        24 / 24
  packages/co-composer:   67 / 67
  packages/song-doc:      18 / 18   (run separately, no `test` filter mismatch)
  packages/g2p:           27 / 27   (run separately, no `test` filter mismatch)
  apps/web:              120 / 120

  Total TS unit tests: 263 / 263
```

### Python services

```
$ cd services/vocal-synth      && pytest -q   → 36 passed
$ cd services/dgx-worker       && pytest -q   → 47 passed, 1 skipped
$ cd services/cover-art-synth  && pytest -q   → 14 passed
$ cd services/music-inference  && pytest -q   → 26 passed

  Total service pytest: 123 passed, 1 skipped
```

### Supabase advisors

Ran `get_advisors(type=security)` against
`lsxicfgqtdxvlcivlwmd`.

- **ERROR-level lints: 0** (the plan's bar).
- **WARN-level lints: 13** — all pre-existing patterns. The two
  v1.3-introduced WARNs both match the existing approved pattern
  used by `create_song_job`, `publish_song`, `recover_song_job`,
  etc.:
  - `cover_art_attempts_touch` mutable `search_path` — same
    pattern as `set_updated_at` and friends, not worth a v1.3
    one-off remediation.
  - `enqueue_cover_art_job` is `SECURITY DEFINER` callable by
    `authenticated`. That is the *point* — see ADR 0014; the RPC
    is the only way authenticated clients can write into pgmq.

No new lints exceeded the WARN bar.

## Extended Playwright surface (added in Sprint 6)

- `apps/web/tests/e2e/landing.spec.ts` (Sprint 5) — pins the wedge
  keyword `phoneme` and the Listen section into HTML.
- `apps/web/tests/e2e/preset-split.spec.ts` (Sprint 6) — asserts
  every v1.3 preset id appears on the landing page and that the
  two new presets (`kannada-bhavageete`, `tamil-folk`) are
  clickable from `/songs/new`. Specifically guards against the
  same silent-drop failure mode that hid `tagore-rabindra-sangeet`
  for months.
- `apps/web/tests/e2e/cover-art.spec.ts` (Sprint 6) — pins the
  `/api/songs/[id]/cover-art` POST/GET contract: status enum,
  202/200 split, signed-url shape. Tolerant of paused DGX.

## Production smoke harness

`infra/scripts/prod-smoke.mjs` extended for v1.3:

- Step 1 now hard-fails if the landing `<h1>` is missing the
  word `phoneme` or `Indian languages` — wedge drift goes red.
- Step 8 (`/songs/new`) now asserts the eight v1.3 presets are
  all present; missing presets fail the step. (The Kannada
  bhavageete / Tamil folk split would have shipped silently
  without this gate.)
- New step 12 (`12-cover-art-panel`) screenshots the cover-art
  panel on a completed song so the DGX-rendered cover-art
  lifecycle is recorded on every smoke run.
- New step `health-anon` issues `/api/health` from a brand-new
  browser context (no auth cookies) and fails if the response
  body leaks a commit SHA — the privacy gate from Sprint 1 is
  now a CI failure, not a manual cURL.
- `SMOKE_OUT` default points at `demos/v1.3/sprint-6-prod-smoke/`
  (was `v1.2`).

The smoke run itself depends on the v1.3 build being live on
production (`neo-fm-web.vercel.app`). The merge below triggers
Vercel's auto-promotion; the post-merge re-smoke writes its
output into `demos/v1.3/sprint-6-prod-smoke/SUMMARY.md`.

## Merge gate

- [x] Web: typecheck + lint + 120 / 120 vitest green.
- [x] Packages: 5 / 5 green (7 + 24 + 67 + 18 + 27 = 143 tests).
- [x] Services: 123 / 123 green (1 skipped is the existing DGX-
      only smoke).
- [x] Supabase advisors: 0 ERROR.
- [x] New e2e specs: landing.spec.ts + preset-split.spec.ts +
      cover-art.spec.ts compile + lint-clean.
- [x] Production smoke harness extended for v1.3 (wedge guard,
      preset coverage, cover-art screenshot, anon health gate).
- [x] All five Sprint demos shipped under `demos/v1.3/`.

After this artefact is committed the branch is ready to merge
`v1.3-wedge → main` via `--no-ff` and the post-merge re-smoke
will land in `demos/v1.3/sprint-6-prod-smoke/`.
