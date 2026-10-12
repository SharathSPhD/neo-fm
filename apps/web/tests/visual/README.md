# Visual regression

Full-page screenshots of the key pages for every combination of UI language
(en, hi, ta, te, kn, bn), viewport (mobile 390px, desktop 1280px) and theme
(light, dark), against a local production build and the in-memory fake Supabase
used by the smoke suite. Nothing real is called or written.

| Pages | Matrix |
| --- | --- |
| landing, pricing, trust, sign-in | viewport x theme (English chrome) |
| public song page, one fixture per script | language x viewport x theme |
| song page with a dedication, embed | viewport x theme |
| library, create (signed in) | UI language x viewport x theme |

Fixtures (fixed lyrics, fixed dates) live in `tests/smoke/fixtures.mjs`; the
fake backend serves them. Every page also asserts there is no horizontal
overflow, which fails even when no baseline exists.

## Run

    pnpm --filter @neo-fm/web test:visual           # build, compare
    pnpm --filter @neo-fm/web test:visual:update    # rewrite baselines

Set `E2E_CHROMIUM` to a Chromium binary if Playwright's own is not installed.
`SMOKE_SKIP_BUILD=1` reuses an existing `.next` built against the fake backend.

## Baselines are CI-rendered

Text rendering depends on the OS and installed fonts, especially Indic scripts.
Baselines are rendered on Linux with `fonts-noto-core` (see
`.github/workflows/visual.yml`), so they will not match a Mac or Windows run.
Use local runs to look at the screenshots; let CI be the judge.

## When a diff fails CI

The `visual (playwright)` job uploads two artifacts:

- `visual-report`: the HTML report with expected, actual and diff images.
- `visual-baselines`: baselines freshly rendered from the PR's code.

If the change is intended, unzip `visual-baselines` over
`apps/web/tests/visual/baselines/` and commit it. The PNG diff in the PR is then
the review. If it is not intended, you found a regression.
