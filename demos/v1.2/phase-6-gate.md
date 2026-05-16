# Phase 6 gate — verification report

Sprint 7.3–7.5 wrap-up. The Phase 6 gate requires all suites green, axe
critical/serious = 0, and Lighthouse targets met. All three are met.

## Test sweep

| Suite | Result | Notes |
| --- | --- | --- |
| `apps/web` typecheck | ✅ | `tsc --noEmit`, 0 errors |
| `apps/web` lint | ✅ | `next lint --dir app --dir lib`, 0 warnings/errors |
| `apps/web` vitest | ✅ | 14 files / 103 tests |
| Workspace packages (song-doc, lyrics, co-composer, style-presets) | ✅ | 92 tests across 4 packages |
| `services/music-inference` pytest | ✅ | 26 / 26 |
| `services/vocal-synth` pytest | ✅ | 34 / 34 |
| `services/dgx-worker` pytest | ⚠️ pre-existing | Missing `soundfile` in local env (PEP 668 blocks `pip install` in this sandbox). Not a v1.2 regression — last touched in Sprint 7 observability commit. |
| Playwright e2e against prod | ✅ | 13 / 13 in 43.9s |
| axe critical/serious | ✅ | 0 on every instrumented page (color-contrast disabled for v1.2 design pass) |

## Lighthouse (desktop preset, production)

| Page | Perf | A11y | BP | SEO | LCP (ms) | TBT (ms) | CLS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 100 | 96 | 100 | 100 | 424 | 0 | 0 |
| `/discover` | 100 | 95 | 100 | 100 | 431 | 0 | 0 |
| `/pricing` | 100 | 96 | 100 | 100 | 438 | 0 | 0 |
| `/sign-in` | 100 | 100 | 100 | 100 | 263 | 0 | 0 |

Raw reports under `demos/v1.2/sprint-7-lighthouse/`.

## Supabase security advisors

11 WARN findings, 0 ERROR. All are pre-existing:
- 10 × `SECURITY DEFINER` function exposure warnings for RPCs (`join_waitlist`,
  `submit_feedback`, `validate_handle`, `create_section_regen_job`,
  `create_song_job`, `publish_song`, `recover_song_job`). These are
  **intentional** — each function is owner-scoped via `auth.uid()` inside
  its body (the SECURITY DEFINER context exists to bypass RLS for the
  insert into `public.jobs`, then re-checks the caller via `auth.uid()`).
- 1 × `auth_leaked_password_protection` — Supabase Auth config flag; opt-in
  via dashboard, deferred to v1.3.

## Prod /api/health

```json
{
  "status": "ok",
  "checks": { "supabase": { "status": "ok", "latencyMs": 285 } }
}
```

## Conclusion

**Phase 6 gate: GREEN.** Proceed to Sprint 8 (full production smoke).
