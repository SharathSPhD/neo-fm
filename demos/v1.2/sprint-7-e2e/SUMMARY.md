# Sprint 7.3 / 7.4 — Playwright E2E + axe-core gate

**Status**: Green. 13/13 specs pass against `https://neo-fm-web.vercel.app` with axe critical/serious = 0.

## Suite

| Spec | Cases |
| --- | --- |
| `auth-flow.spec.ts` | anon landing + sign-in → `/library` w/ Library nav label |
| `song-create.spec.ts` | `POST /api/songs` → 202 + queued job; song detail page renders |
| `library-and-discover.spec.ts` | grid default, list toggle, discover anon + authed |
| `upgrade.spec.ts` | `/pricing` anon + authed, `/api/billing/checkout` 200/303/503 contract |
| `command-palette.spec.ts` | Ctrl+K opens palette, type "Disc" → Enter → `/discover` |
| `remix.spec.ts` | Make a remix → 202, lineage stamped, backlink visible |

## Run

```bash
pnpm --filter @neo-fm/web test:e2e
```

13 passed (43.9s).

## a11y gate (Sprint 7.4)

`tests/e2e/helpers/axe.ts` runs axe-core on every covered page and fails the
test if any **critical** or **serious** violation is found. `color-contrast`
is intentionally disabled for v1.2 (tracked for v1.3 design pass).

Pages instrumented:
- `/`
- `/library` (both grid + list views)
- `/discover` (anon + authed)
- `/songs/[id]` (own + remix)
- `/pricing` (anon + authed)
- command-palette open state

All clean.

## Config

`apps/web/playwright.config.ts` — production-pointed baseURL, serial workers
(production smoke, no parallelism budget), `retain-on-failure` trace,
`only-on-failure` screenshot, 90s/test timeout.

## Smoke user

`e2e-smoke@neo-fm.test` (Creator tier, Sprint 5c).
