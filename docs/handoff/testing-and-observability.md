# Handoff: rate limiting, smoke tests, visual regression, error observability

## State
- **Rate limiting (merged):** `apps/web/lib/rate-limit.ts`, applied in `middleware.ts` to `/api/*`, auth submits and report endpoints. Upstash-backed when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set, otherwise an in-memory fixed window. A 150ms Upstash timeout and a 10s circuit breaker fall back to memory. `/api/client-errors` has its own bucket (10/min).
- **Smoke suite (merged):** `apps/web/tests/smoke/`, run with `pnpm --filter @neo-fm/web test:smoke`. Builds against an in-memory fake Supabase (`fake-supabase.mjs`); no real backend, Lyria or prod writes. `SMOKE_BASE_URL=https://<preview>` runs the read-only specs only.
- **Error observability (merged):** request ids (`x-request-id`), JSON logs (`lib/obs/log.ts`), PII scrubber, error boundaries, `POST /api/client-errors` (always 204), the "Recent errors" panel on `/admin/health`, migration `0080_client_errors.sql` (service-role only; `prune_client_errors()` keeps 7 days).
- **Visual regression (PR #83, open, advisory):** 96 full-page screenshots (6 UI languages x mobile/desktop x light/dark) plus smoke for dedication, embed, share cards and non-Latin lyrics. The visual job is `continue-on-error`, so it never blocks a merge.

## Run and verify locally
- Smoke: `pnpm --filter @neo-fm/web test:smoke` (set `E2E_CHROMIUM` if Playwright's Chromium is missing; `SMOKE_SKIP_BUILD=1` reuses `.next`).
- Visual (after #83): `pnpm --filter @neo-fm/web test:visual`. Baselines are rendered in CI (Linux, `fonts-noto-core`), so local Mac/Windows runs will not match; use them to look, not to judge.
- Unit: `pnpm --filter @neo-fm/web test` (rate-limit, obs, client-errors tests).

## Open risks
- Until the two Upstash env vars are set in Vercel prod, rate limiting is per-instance memory only, so limits are loose under load.
- Migration `0080` must be applied to prod for the errors panel; the routes degrade quietly without it.
- #83 baselines will diff once the in-flight UI PRs merge. Regenerate once: merge main, then commit the `visual-baselines` artifact from the failed visual run over `apps/web/tests/visual/baselines/`. Then drop `continue-on-error` in `.github/workflows/visual.yml` to make it blocking.
- New error-page strings (`error.home`, `error.ref`) in hi, ta, te, kn and bn need native-speaker review.
- Two UI findings from the baselines are unowned: low-contrast amber "Audio preview not available" in the light theme, and the mobile bottom nav overlapping content (check the last form controls on `/songs/new` on a real phone).

## Next 3 steps
1. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel prod and apply `0080`.
2. When the UI PRs land, regenerate the visual baselines once, then make the job blocking.
3. Add collections (#70) and insights (#62) to `tests/smoke/newer-flows.spec.ts` and `tests/visual/visual.spec.ts` once merged.
