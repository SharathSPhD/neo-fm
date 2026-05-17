# Sprint 2 — Style preset + schema full split

**Status:** ✅ green
**Branch:** `v1.3-wedge`
**Author:** v1.3 wedge plan (auto)

## What shipped

### Postgres + Zod schema

- **Migration 0032 (`0032_style_family_extension.sql`)** adds two new
  values to `public.style_family_enum`:
  - `kannada-light-classical` for bhavageete / sugama-sangeetha
  - `tamil-folk` for parai-style janapada
- **Migration 0033 (`0033_language_ta.sql`)** adds `'ta'` to
  `public.language_enum` so Tamil-folk presets stop leaning on
  `metadata.language_hint`.
- `packages/song-doc/src/index.ts` extends `LanguageSchema` and
  `StyleFamilySchema` to match the database. Pydantic-side parity comes
  through Supabase's regenerated `database.types.ts`.

### Co-composer split

- New `KannadaLightClassicalCoComposer`
  (`packages/co-composer/src/kannada-light-classical.ts`): pinned
  `genre:bhavageete`, harmonium-led orchestration, slower default
  tempo (88 bpm), 6/8 sahityaa-friendly meter, pallavi/charanam
  section vocabulary.
- New `TamilFolkCoComposer`
  (`packages/co-composer/src/tamil-folk.ts`): parai-driven 4/4 dance
  defaults (parai + thavil + nadaswaram + flute), male-lead default,
  `region:tamil` tag.
- `KannadaFolkCoComposer` flipped its default genre from `bhavageete`
  back to `janapada` (the right default for "pure folk") now that
  bhavageete has its own composer.
- `getCoComposer()` registry extended with both new families;
  exhaustive switch keeps TypeScript honest.

### Presets

- `KANNADA_BHAVAGEETE` now uses
  `style_family: "kannada-light-classical"`, harmonium/tabla/tanpura
  orchestration, and chips
  `["Kannada", "Light-classical", "Sugama sangeetha"]`. Copy clarifies
  bhavageete is not folk.
- `TAMIL_FOLK` now uses `style_family: "tamil-folk"` + `language: "ta"`
  + parai/thavil/nadaswaram orchestration. Sections are stamped with
  `script: "tamil"`. `metadata.language_hint` is removed (no longer
  needed); `metadata.region: "tamil"` replaces it.
- `apps/web/app/(marketing)/page.tsx` fixed the silently-dropped
  `tagore-rabindra-sangeet` preset id in `HIGHLIGHT_PRESET_IDS` →
  `tagore-set`.

### Downstream consumers wired through

- `apps/web/app/(app)/songs/new/creation-canvas.tsx`: `StyleFamily` +
  `Language` union, `STYLE_OPTIONS`, `LANGUAGE_OPTIONS`,
  `DEFAULT_SECTION_FOR_STYLE`, `allowedFor` map all extended.
- `apps/web/lib/song/labels.ts`: `prettyStyle()` and `prettyLanguage()`
  cover both new values.
- `apps/web/components/cover-art.tsx`: `hueForStyle()` adds a distinct
  hue band per family (kannada-light-classical→magenta-rose,
  tamil-folk→warm-vermillion). Two new cover-art regression tests pin
  the bands so future palette changes don't drift silently.
- `apps/web/lib/supabase/database.types.ts` regenerated to reflect the
  new enum values (Supabase MCP `generate_typescript_types`).
- `services/dgx-worker/app/models.py` — `StyleFamily` literal extended.
- `services/music-inference/app/model.py` — `_STYLE_TAGS` adds tag sets
  for both new families so HeartMuLa picks the right register.
- `services/vocal-synth/app/model.py` — `style_family` literal extended.
- `services/vocal-synth/app/parler.py` — `voice_descriptor()` adds
  adornment phrases for both new families.
- `packages/lyrics/src/provider.ts` + `src/section-mapper.ts` — both
  records cover the new families (Tamil-folk → `ta`; bhavageete uses
  poem-shaped sections).

### Tests

- `packages/co-composer/src/kannada-light-classical.test.ts` (10 cases)
- `packages/co-composer/src/tamil-folk.test.ts` (8 cases)
- `packages/co-composer/src/kannada-folk.test.ts` updated (default
  genre flipped from bhavageete to janapada).
- `apps/web/tests/lib/cover-art.test.ts` gains two band-bias tests.
- `apps/web/tests/app/api/lyrics.test.ts` switched its "unknown
  language" fixture from `ta` (now valid) to `xx`.
- `packages/style-presets/src/index.test.ts` "India-first ordering"
  test expanded to include both new families in the allow-list.

## Ralph gate

See [`ralph-evidence.md`](./ralph-evidence.md). All three checks pass:

| Check                                                                  | Result        |
|------------------------------------------------------------------------|---------------|
| `apply_migration 0032 + 0033`                                          | green ✅      |
| Postgres enums contain new values                                      | confirmed ✅  |
| `get_advisors` (security): no new ERROR                                | confirmed ✅  |
| Workspace test sweep (song-doc + co-composer + style-presets + lyrics) | 110/110 ✅    |
| Web typecheck + lint + vitest                                          | 111/111 ✅    |
| `pnpm -r build`                                                        | green ✅      |

## Out of scope

- The Sprint 2 Playwright preset-smoke (asserts each preset's
  "Use this style" → 202) ships in Sprint 6's QA sweep, against the
  deployed v1.3 build — running it from this commit would race the
  rolling Vercel deploy and produce a flaky baseline.
