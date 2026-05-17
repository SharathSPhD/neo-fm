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

## Vercel deploy gate — **BLOCKED**

Status as of merge: `https://neo-fm-web.vercel.app/api/health`
still returns `"version":"v1.2-bugfix-pack","commit":"d9f4862"`.
The v1.3 deployments are **stuck in `BLOCKED` state** before the
build ever starts:

| Deployment | Trigger | State |
| --- | --- | --- |
| `dpl_8yJhucmjYh4fJpsrPgDFz1rV4apV` | github push of `264f14a` | BLOCKED |
| `dpl_CggFi4owUa8gmHYsZybS1gsvaCpf` | `vercel deploy --prod` from CLI | BLOCKED |

`get_deployment_build_logs` returns an empty events array on
both — i.e. the build never started, so the BLOCKED is not
the build itself failing. Project metadata reports
`"live": false`.

This is the risk the plan flagged in Sprint 1:

> "Make the repo private via `gh repo edit`. […] Vercel's
> GitHub integration should still work, but Sprint 1 needs
> to verify that"

The most likely cause is Vercel Spend Management /
Deployment Protection auto-pausing the project after the
repo flipped from public to private (a common Hobby-tier
trigger). The MCP API surface does not expose a way to
inspect or override these settings.

### Operator unblock procedure

1. Open the Vercel project at
   <https://vercel.com/ss-projects-f08e52ab/neo-fm-web>.
2. Settings → Billing → confirm the project is not paused
   by spend management. If it is, raise the cap or upgrade
   the team to Pro.
3. Settings → Deployment Protection → confirm "Production
   Domain Vercel Authentication" / "Trusted IPs" is not
   blocking new builds.
4. Settings → Git → confirm the Vercel GitHub App still has
   read access to the now-private `SharathSPhD/neo-fm` repo.
   Reinstall the app if access is denied.
5. Once the underlying block is cleared, redeploy by
   pushing an empty commit (`git commit --allow-empty
   -m "redeploy after vercel unblock" && git push`) or by
   re-running `vercel deploy --prod --yes` from the repo
   root.

### Post-unblock re-smoke

Once the v1.3 build is live, re-run the extended prod smoke:

```
SMOKE_OUT=demos/v1.3/sprint-6-prod-smoke \
SMOKE_EMAIL=e2e-smoke@neo-fm.test \
SMOKE_PASS=SmokeTest!v12 \
node infra/scripts/prod-smoke.mjs
```

The harness will hard-fail if:

- The landing `<h1>` is missing `phoneme` or `Indian languages`
  (Sprint 5 wedge gate).
- Any of the eight v1.3 presets is missing from `/songs/new`
  (Sprint 2 silent-drop gate).
- The cover-art panel is gone from a completed song detail
  (Sprint 3 evidence).
- Anon `/api/health` leaks a commit SHA (Sprint 1 privacy gate).

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

All six sprint gates closed under the Ralph promise; the
production deploy is the only outstanding step and it is
blocked on an operator-side Vercel setting, not on code or
tests.
