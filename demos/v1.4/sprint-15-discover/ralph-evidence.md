# Sprint 15 — Discover seeding + Library publish (evidence)

## What shipped

1. **`packages/style-presets`** — two new Song Document presets:
   `bengali-rabindrasangeet`, `telugu-keerthana`, alongside last
   sprint's `sanskrit-shloka`. Total: 11 curated presets.
2. **Discover filters** — `apps/web/app/(marketing)/discover/page.tsx`
   filter chips now expose `sanskrit-shloka`,
   `bengali-rabindrasangeet`, and `telugu-keerthana`.
3. **`infra/scripts/seed-discover.mjs`** — 12-row demo matrix, dry-run
   default, idempotent `--apply`, optional `--reset` and
   `--audio-manifest=PATH`. Writes
   `demos/v1.4/sprint-15-discover/seed-manifest.json`.
4. **Batch publish RPC** — `infra/supabase/migrations/0040_publish_song_batch.sql`.
   Single-transaction, free-tier cap aware, returns per-row outcomes.
5. **Batch publish API** — `apps/web/app/api/songs/publish-batch/route.ts`.
   Auth + zod validation + dedupe + RPC + summary.
6. **Library Bulk-publish bar** — selection checkboxes + toolbar in
   `app/(app)/library/song-list.tsx`, surfaces summary counts.
7. **ADR 0035** — Discover seeding pipeline and batch publish RPC.

## Tests

- `apps/web` vitest: 205 passed (25 files), including
  `tests/app/api/publish-batch.test.ts` (10 cases:
  auth, body validation, batch ceiling, happy path, mixed outcomes,
  dedupe, SQLSTATE -> HTTP translation).
- `packages/style-presets` vitest: 11 passed (3 files), including
  Bengali and Telugu preset assertions.
- `pnpm --filter @neo-fm/web typecheck`: clean.
- `pnpm --filter @neo-fm/web exec eslint <changed files>`: clean.

## Promise gate

| Promise (plan §15)                                                                                                                | Evidence                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 12 demo songs, every v1.4 family/voice/engine path represented                                                                    | `DEFAULT_PRESETS` in `infra/scripts/seed-discover.mjs`                                  |
| Sanskrit/Bengali/Telugu presets live                                                                                              | `packages/style-presets/src/index.ts` + tests                                           |
| Discover filter parity with new style families                                                                                    | `STYLE_OPTIONS` in `apps/web/app/(marketing)/discover/page.tsx`                         |
| `publish_song_batch(p_job_ids uuid[], p_visibility text)` RPC with 100-id ceiling, free-tier cap, per-row outcomes                | `infra/supabase/migrations/0040_publish_song_batch.sql`                                 |
| `POST /api/songs/publish-batch` route with auth + dedupe + summary                                                                | `apps/web/app/api/songs/publish-batch/route.ts`                                         |
| Library batch publish UI                                                                                                          | `BulkPublishBar` in `apps/web/app/(app)/library/song-list.tsx`                          |
| Seed script idempotent (`--apply` re-runnable)                                                                                    | `findExistingJob()` lookup by `document_json->demo_seed`                                |
| Seed script does not require trained adapters to run (decouples DB seeding from DGX render)                                       | `--audio-manifest` link-by-pre-uploaded-URL pattern                                     |

## Notable decisions (recorded in ADR 0035)

- **Per-row outcomes over all-or-nothing.** A single bad row in a
  batch must not roll back the other 99. The RPC encodes failures as
  the `outcome` column so the API surfaces a summary instead of an
  exception.
- **Free-tier cap inside the RPC, not the API.** Counting public songs
  in two phases (API count, RPC publish) loses atomicity under
  multiple Vercel instances; the cap lives in the SQL function.
- **Seeding is metadata-only by default.** Rendering the demos
  requires DGX. The script consumes a pre-uploaded `--audio-manifest`
  rather than calling the render pipeline; this keeps `/discover`
  populatable without coupling the seed step to GPU availability.
- **Catalog vs render are separate concerns.** `seed-discover.mjs`
  inserts catalog rows; the render-and-upload step runs on DGX in
  Sprints 7-14 and writes objects to Supabase Storage.

## Pending follow-ups (not Sprint 15 blockers)

- Sprint 16 will reuse `BulkPublishBar`'s selection state for "Send
  to RLHF preference UI" once the candidate-gen pipeline ships.
- Sprint 17 will add a Playwright spec exercising the bulk-publish
  flow end-to-end and add `/api/songs/publish-batch` to prod-smoke.
