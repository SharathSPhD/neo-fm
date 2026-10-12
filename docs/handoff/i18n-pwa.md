# Handoff: i18n, first-run, PWA, mobile

## State (2026-10-12)

- **First-run guided creation** (#49) and **PWA / mini-player / Media Session / data saver** (#57): merged.
- **Full UI localization** (#72, #81): merged. hi/ta/te/kn/bn cover nav, landing, pricing, discover, account, profile, auth, create flow, song actions, library, public pages, help/trust/templates. Language = cookie `neo-fm-lang`, then `Accept-Language`, then English; server components use `serverI18n()`, client components `useUiLang()`.
- **Native-speaker review page** (#88, draft): token link `/ui-review/<token>`, admin API `/api/admin/ui-review` (`ADMIN_SECRET` bearer), patch export, `scripts/apply-ui-review.mjs`. Needs migration `0086_ui_review.sql` applied to prod. DB-backed path never tested end to end.
- **Light-theme amber notice + mobile bottom-nav safe area** (#94): open, green.
- Every non-English string is `pending-review` in `TRANSLATION_STATUS`. Nothing is marked `reviewed`.

## Run and verify locally

```
cd apps/web
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm exec vitest run                      # includes tests/lib/i18n-coverage.test.ts and tests/lib/ui-review.test.ts
pnpm exec playwright test tests/e2e/language.spec.ts tests/e2e/first-run-preview.spec.ts tests/e2e/player-preview.spec.ts
node ../../scripts/check-migrations-security.mjs
```

The Playwright specs need dummy Supabase env (see `docs/DEV-PREVIEW.md`). The reviewer UI has a dev-only harness at `/dev-preview/ui-review` (save endpoint mocked).

Adding a string: add the key to all six files in `lib/i18n/locales/` (one `"key": "value",` per line, `{name}` placeholders and `[[accent]]` markers identical across languages), use it as a string literal. The coverage test fails on missing, undefined or unused keys and on placeholder drift. Details and the review workflow: `docs/i18n.md`.

## Open risks

1. Translations are first-pass machine output. Wrong or stiff wording is likely until native review happens.
2. #88 is untested against a live Supabase. Verify token mint, save, report and patch on a branch DB before sending links to reviewers.
3. Left in English on purpose: OG/share/dedication images, `/admin/health`, embed iframe, style/raga/tala data, raw API errors, the "why this song" line, emails.
4. Visual baselines (#83) need a refresh after #94 (light amber notice).

## Next 3 steps

1. Apply `0086_ui_review.sql`, mint one review link per language (`POST /api/admin/ui-review?action=token`), send them to native speakers.
2. Export approved edits (`GET ...?action=patch`), apply with `scripts/apply-ui-review.mjs --mark-reviewed`, review the diff, merge.
3. Localize the remaining English surfaces from risk 3 that matter most (emails and the embed iframe first).
