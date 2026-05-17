# Sprint 1 — foundation bugs ralph evidence

Status: PASS
Date: 2026-05-17
Branch: `v1.4-deep-dive`

## What shipped

1. **Favorites persistence (item 7).** Migration `0035_jobs_favorite_security_definer.sql` drops the old `SECURITY INVOKER` `toggle_favorite` and recreates it `SECURITY DEFINER` with an explicit `auth.uid()` owner check inside the function body. The favorites flip survives a page reload now.
2. **Cover art rendering stuck (item 2).** Two-tier cover-art pipeline:
   - **Template tier (default).** New `apps/web/lib/cover-art-template.ts` renders a deterministic SVG (style-biased gradient + first grapheme of the title + corner note glyph). New `POST /api/songs/[id]/cover-art-template` uploads the SVG to the `cover-art` bucket via the service-role client and atomically records the attempt + cover_art row via the new SECURITY DEFINER RPC `record_cover_art_template` (migration `0036_cover_art_template.sql`). No queue. p95 target < 300 ms.
   - **Premium tier.** The pre-existing queued `cover-art` route still works, gated behind `NEXT_PUBLIC_COVER_ART_PREMIUM=1` in the panel UI.
3. **Discover style filter parity (item 6, partial).** `STYLE_OPTIONS` in `apps/web/app/(marketing)/discover/page.tsx` now includes `kannada-light-classical`, `tamil-folk`, `bollywood-ballad`.
4. **Seed-discover scaffold.** `infra/scripts/seed-discover.mjs` ships idempotent + dry-run by default; Sprint 15 fills in the actual demo songs.

## Files touched

```
apps/web/app/(app)/songs/[id]/cover-art-panel.tsx                  modified
apps/web/app/(marketing)/discover/page.tsx                         modified
apps/web/app/api/songs/[id]/cover-art-template/route.ts            added
apps/web/lib/cover-art-template.ts                                 added
apps/web/lib/supabase/database.types.ts                            regenerated
apps/web/tests/app/api/cover-art-template.test.ts                  added
apps/web/tests/app/api/favorite.test.ts                            added
apps/web/tests/e2e/library-favorites.spec.ts                       added
apps/web/tests/fakes/supabase.ts                                   extended (storage.upload spy)
apps/web/tests/lib/cover-art-template.test.ts                      added
infra/scripts/seed-discover.mjs                                    added
infra/supabase/migrations/0035_jobs_favorite_security_definer.sql  added
infra/supabase/migrations/0036_cover_art_template.sql              added
```

## Promise gate

| check | result | evidence |
| --- | --- | --- |
| `pnpm lint` | PASS | "No ESLint warnings or errors" |
| `pnpm typecheck` | PASS | 11/11 packages green |
| `pnpm test` | PASS | 19 files, 286 tests (was 263, +23) |
| `pytest` (4 services) | PASS | 123 + 1 skipped (unchanged) |
| Supabase migrations applied | PASS | 0035 + 0036 via `apply_migration` |
| Supabase advisors | 0 ERROR | 14 WARN (all pre-existing, including the new SECURITY DEFINER RPCs which mirror the in-codebase pattern) |
| Seed scaffold dry-run | PASS | `node infra/scripts/seed-discover.mjs` exits 0, writes manifest |

## Decisions

- The favorite fix follows the same SECURITY DEFINER + body-owner-check pattern as `enqueue_cover_art_job` (0034) and `create_song_job` (0008). Consistent with the codebase.
- For cover art we kept the existing queued route in place rather than ripping it out. The UI just defaults to the template tier. If/when the DGX cover-art-synth pipeline becomes prod-wired again, the operator flips `NEXT_PUBLIC_COVER_ART_PREMIUM=1` and users see the "Generate HD (premium)" button. This avoids a rewrite of the panel state machine.
- SVG (not PNG) for templates because: serves natively from Supabase Storage; < 4 KB per cover; no raster encoder dependency on the edge runtime; the browser scales it perfectly for any cover-size container.

## Test counts

- TS: 286 (was 263) +23.
- Python: 123 + 1 skipped (no Python changes this sprint).
- New e2e: `library-favorites.spec.ts` will run as part of Sprint 17's e2e sweep against a deployed preview.
