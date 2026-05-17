# Sprint 2 — SongDocument schema v1.4

**Status:** complete  
**Branch:** `v1.4-deep-dive`

## Shipped

1. **Zod widening** (`packages/song-doc/src/index.ts`)
   - `LanguageSchema` adds `bn`, `te`, `sa` (Sprint 6 + Sprint 14 + Sprint 15 corpora).
   - `StyleFamilySchema` adds `bollywood-ballad`, `sanskrit-shloka`,
     `bengali-rabindrasangeet`, `telugu-keerthana`.
   - `RagaSpecSchema.system` widens to `["carnatic", "hindustani", "light-classical", "folk"]`.
   - New `STYLE_RAGA_ALLOWLIST` enforces per-style raga validity (rejects e.g. `western` + raga).
   - New `BackgroundMixSchema` (density / dynamics / brightness / reverb) +
     `voice_id` field on `SongDocumentSchema`.
   - New `SectionTypeSchema` values for Sanskrit chant: `shloka_verse`, `shloka_refrain`, `phalashruti`.

2. **Pydantic mirror** (`packages/song-doc/python/`)
   - Re-exported `song-doc.schema.json` and re-ran `scripts/song-doc-codegen.py`.
   - `models.py` mirrors the per-style raga allow-list (`_STYLE_RAGA_ALLOWLIST`).
   - 4 new tests in `tests/test_fixtures.py` for the v1.4 widening.

3. **music-inference contract** (`services/music-inference/app/`)
   - `serve.py` `GenerateRequest.language` and `style_family` Literals widen.
   - `serve.py` `_RagaSpec.system` widens.
   - New optional `voice_id` field.
   - `model.py` `_SECTION_HEADERS` adds entries for every Indic + Sanskrit section type
     so HeartMuLa structural-contrast tags route deterministically.
   - `model.py` `_STYLE_TAGS` adds tag seeds for the four new style families.

4. **section-mapper templates** (`packages/lyrics/src/section-mapper.ts`)
   - Added templates for `bollywood-ballad`, `bengali-rabindrasangeet`,
     `telugu-keerthana`, `sanskrit-shloka`.

5. **lyric provider** (`packages/lyrics/src/provider.ts`)
   - `STYLE_LANGUAGE_ALLOWED` extended with the four new families (Sprint 6
     will replace this with a FS-driven map; for now each new family is
     paired with its source language).

6. **co-composer routing** (`packages/co-composer/src/index.ts`)
   - `getCoComposer` switch is exhaustive over the widened `StyleFamily`,
     temporarily delegating new families to the closest existing composer
     (Western → Bollywood ballad, Hindustani → Rabindrasangeet,
     Carnatic → keerthana + shloka). Dedicated composers land in
     Sprint 8 / Sprint 14 / Sprint 15.

7. **Migration** (`infra/supabase/migrations/0037_song_doc_v1_4_widening.sql`)
   - Adds `bn`, `te`, `sa` to `public.language_enum`.
   - Adds `bollywood-ballad`, `sanskrit-shloka`, `bengali-rabindrasangeet`,
     `telugu-keerthana` to `public.style_family_enum`.
   - Applied to `lsxicfgqtdxvlcivlwmd` (neo-fm) — `enum_range` confirms.

8. **Types refresh** (`apps/web/lib/supabase/database.types.ts`)
   - Regenerated against the live schema; reflects all v1.4 enum
     additions and prior Sprint 1 RPCs.

## Files touched

- `packages/song-doc/src/index.ts`
- `packages/song-doc/src/index.test.ts`
- `packages/song-doc/song-doc.schema.json` (regenerated)
- `packages/song-doc/python/neo_fm_song_doc/_generated.py` (regenerated)
- `packages/song-doc/python/neo_fm_song_doc/models.py`
- `packages/song-doc/python/tests/test_fixtures.py`
- `services/music-inference/app/serve.py`
- `services/music-inference/app/model.py`
- `packages/lyrics/src/section-mapper.ts`
- `packages/lyrics/src/provider.ts`
- `packages/co-composer/src/index.ts`
- `infra/supabase/migrations/0037_song_doc_v1_4_widening.sql`
- `apps/web/lib/supabase/database.types.ts`
- `demos/v1.4/sprint-2-song-doc-schema/ralph-evidence.md` (this file)

## Test results

- `pnpm -r typecheck` — clean
- `pnpm -r test` — 286 → 295 TS tests, all passing
  - song-doc: 18 → 25 (+7 v1.4)
  - apps/web: 143 unchanged (covered by Sprint 1)
- `uv run pytest` per service:
  - song-doc/python: 6 → 10 (+4 v1.4)
  - music-inference: 26 unchanged
  - dgx-worker: 49 (1 skipped) unchanged
  - vocal-synth: 36 unchanged
  - cover-art-synth: 14 unchanged
- `pnpm --filter @neo-fm/web lint` — clean

## Supabase advisors

- 0 new advisories. Existing 14 WARN-level items unchanged (all
  pre-existing `function_search_path_mutable` / `auth_leaked_password_protection`).

## Notable decisions

- **Raga allow-list, not 1:1.** The plan's "widen raga.system for
  light-classical/folk" called for per-style policy. We codified it
  with `STYLE_RAGA_ALLOWLIST` in both Zod and Pydantic so the rule
  is visible in one place and reviewable as data. Bhavageete +
  Carnatic raga is the canonical case this unblocks.
- **`voice_id` is opaque.** The schema treats it as a 1..64-char
  string. Sprint 5 owns the catalog. This avoids needing a schema
  redeploy every time a voice ships.
- **New co-composer routing is delegating, not throwing.** The
  exhaustive switch routes new families to their closest existing
  co-composer so the worker can already elaborate v1.4 SongDocuments
  end-to-end. Sprint 8 / Sprint 14 / Sprint 15 will flip individual
  cases as dedicated composers land.
- **`STYLE_LANGUAGE_ALLOWED` is still a static map.** The plan calls
  out FS-driven detection as the Sprint 6 deliverable; this sprint
  just keeps the map exhaustive so typecheck stays clean while we
  build the corpus.
