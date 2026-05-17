# v1.4 live-bug closeout — SUMMARY

**Plan**: `~/.cursor/plans/v1.4_live-bug_closeout_3b3f19c5.plan.md`
**Branch**: `fix/v1.4-live-bugs`
**Author**: this commit set
**Status**: code complete and tested locally; merge + prod re-smoke
pending operator action (see "Pending operator steps" at the bottom).

## Headline result

Eight live-prod bugs reported after the v1.4 deployment were closed
end-to-end with the smallest set of focused changes the plan
specified — no new composers, no synthesised audio for the seeded
Discover catalog. The class of bug that ships when the dispatcher's
"temporary delegation" comment contradicts each composer's hard
equality guard is now caught by tests: a new
`packages/co-composer/src/dispatcher.test.ts` loops every
`StyleFamily` literal through `getCoComposer().elaborate()` and
`apps/web/tests/app/api/songs.test.ts` gained four new POST cases
that fail red the next time a delegated family slips.

Full repo-wide signal at the time of this writing:

* `pnpm -r typecheck` — green
* `pnpm -r test` — 351 tests pass (was 219 in apps/web; now 219
  there + 11 new dispatcher tests + 4 new POST cases inline)

## Bug-by-bug closeout

| # | Reported bug | Root cause | Fix |
| --- | --- | --- | --- |
| 1 | Discover page audio: every card says "still being prepared" | The amber notice fires whenever there is no track row, regardless of `status`. The seeded catalog rows have no tracks. | Phase 3.5 branches the copy by `status` ("Rendering now" vs "Audio preview not available") and tightens the Discover query to require `tracks!inner` so catalog-only rows never surface to users on /discover. |
| 2 | Cover-art generation: "Bucket not found" | Migration 0026 declared the bucket "must be created out-of-band" and no migration ever created it. | Phase 2.1 ships `infra/supabase/migrations/0042_cover_art_bucket.sql` (idempotent, 5 MB cap, png/jpeg/webp, service-role write policy) and the bucket was applied to prod via MCP. |
| 3 | Song generate / remix UI: only "key western" available, no voice dropdown, no remix dropdown | Free-text inputs for voice and raga; `WESTERN_STYLES` in the dialog included `bollywood-ballad` which the applier rejects. Tempo input rendered the min={30} default as a misleading placeholder. | Phase 3.1: voice and raga become `<select>`s sourced from `VOICE_CATALOGUE` and `ragasForStyle`; tempo becomes `type="text" inputMode="numeric"`; `WESTERN_STYLES` aligns with `fork-applier.ts`; the dialog accepts `initialTempo` / `initialKey` / `initialVoiceId` / `language` and `/songs/[id]` + `/s/[publicId]` thread these in. |
| 4 | Song sharing: unclear `/explore` path, no confirmation button | Copy was stale (no `/explore` route ever shipped); the only dismiss control was a tiny ×. | Phase 3.2: replaces `/explore` with `/discover` everywhere in the dialog and adds a bottom-right Done button (autofocused on open). |
| 5 | Landing "Open template gallery" link is broken | Linked to `/songs/new`, which redirects anonymous visitors to `/sign-in` with no preset hint. | Phase 3.4: new public `/templates` page renders a read-only PresetGallery; each card links to `/sign-in?next=/songs/new?preset=<id>`. Landing CTAs ("See the templates", "Open template gallery →") now point at `/templates`. |
| 6 | Library favorites filter shows "no songs yet" even when the user has songs | The page used the *filtered* total as a proxy for library-empty; "Favorites only" + zero favorites = filtered total of zero = misleading empty state. | Phase 3.3 adds an unfiltered `libraryTotal` count and branches the empty state on that. The page header now says "No matches" when the filter matches nothing but the library has songs. |
| 7 | Voice previews: clicking play does nothing | `voice-samples` bucket existed but `samples/<voice_id>.wav` objects were never uploaded; the picker silently `.catch(() => clearPlaying)`. | Phase 2.2: the 16 voice WAVs were rendered via `render_voice_previews.py` (now usable without the heavy ML dependency stack) and uploaded with a new `infra/scripts/upload-voice-previews.mjs` (Node + `@supabase/supabase-js` to sidestep the `sb_secret_` JWS issue). Phase 2.3 surfaces inline "Preview unavailable" with `aria-live="polite"` so any future regression is visible. |
| 8 | Song queue `POST` returns 400 `co_composer_rejected` | `getCoComposer` delegated four families to the Carnatic / Hindustani / Western fallbacks but each composer's `elaborate()` rejected anything whose `style_family` was not its single native family. | Phase 1: added `acceptedStyleFamilies: ReadonlySet<StyleFamily>` to the `CoComposer` interface; each composer enumerates the delegated families it can absorb; the dispatcher carries the user-facing family through to tags. Bollywood preset's `style_family` is now `"bollywood-ballad"` (was `"western"`). New `dispatcher.test.ts` loops every literal; `songs.test.ts` adds POST cases for the four delegated families. |

## Commits on this branch

```
8b3ffab fix(co-composer): accept delegated style families via acceptedStyleFamilies
55f8075 fix(infra): cover-art bucket, voice-preview render+upload, voice error UI
9b30a67 fix(ui): fork dropdowns, share /discover copy, library empty-state, /templates, audio copy
921b28b test(v1.4): e2e + prod-smoke coverage for live-bug closeout
```

Each commit is scoped to a single plan phase per the plan's Phase 5
guidance ("Implement Phases 1-4 with commits scoped per phase").

## Test coverage added

* `packages/co-composer/src/dispatcher.test.ts` (new, 11 tests) —
  iterates every `StyleFamily` literal through
  `getCoComposer().elaborate()` and re-parses the result against
  `SongDocumentSchema`. The plan's "the gap that let this ship" check.
* `apps/web/tests/app/api/songs.test.ts` — four new POST cases for
  `sanskrit-shloka`, `telugu-keerthana`, `bengali-rabindrasangeet`,
  and `bollywood-ballad`, asserting `202` and the right `style:*` tag.
* `apps/web/tests/e2e/sprint-17/variation-dialog.spec.ts` —
  rewritten to pick voice + raga from the dropdowns and assert the
  request body contains `voice_id` and `raga_override.name`.
* `apps/web/tests/e2e/sprint-17/remix-dialog.spec.ts` — same
  treatment for the remix flow, plus fixed an ambiguous selector
  (`placeholder="(inherit)"` now matches multiple inputs).
* `apps/web/tests/e2e/sprint-17/library-favorites-empty.spec.ts`
  (new) — asserts the empty state shows "No matches" not "No songs
  yet" when the user has songs but no favorites.
* `apps/web/tests/e2e/sprint-17/share-dialog-copy.spec.ts` (new) —
  asserts `/discover` (not `/explore`) and that Done dismisses.
* `apps/web/tests/e2e/sprint-17/discover-non-empty.spec.ts` —
  extended to assert each visible Discover card's `/s/<publicId>`
  page renders no "still being prepared" / "Audio preview not
  available" notice.
* `infra/scripts/prod-smoke.mjs` — two new steps: `24a-buckets-exist`
  probes the `cover-art`, `voice-samples`, and `tracks` buckets via
  the Supabase storage REST API (would have caught bug #2 on the
  first prod deploy); `24b-voice-previews` HEADs a handful of
  voice-sample object URLs (would have caught bug #7).

## Files changed

```
 apps/web/app/(app)/library/page.tsx                |  17 ++-
 apps/web/app/(app)/songs/[id]/fork-song-dialog.tsx | 147 +++++++++++--
 apps/web/app/(app)/songs/[id]/page.tsx             |  22 +++
 apps/web/app/(app)/songs/[id]/remix-button.tsx     |  13 ++
 apps/web/app/(app)/songs/[id]/share-button.tsx     |  24 +-
 apps/web/app/(app)/songs/[id]/variation-button.tsx |  16 ++
 apps/web/app/(app)/songs/new/voice-picker.tsx      | 116 ++++++++---
 apps/web/app/(marketing)/discover/page.tsx         |   6 +
 apps/web/app/(marketing)/page.tsx                  |   4 +-
 apps/web/app/(marketing)/templates/page.tsx        | +137 (new)
 apps/web/app/api/songs/[id]/favorite/route.ts      |   8 +-
 apps/web/app/s/[publicId]/embed/page.tsx           |   6 +-
 apps/web/app/s/[publicId]/page.tsx                 |  26 +-
 apps/web/tests/app/api/songs.test.ts               | 157 +++++++++++++
 apps/web/tests/e2e/sprint-17/discover-non-empty.spec.ts |  64 ++-
 apps/web/tests/e2e/sprint-17/library-favorites-empty.spec.ts | +49 (new)
 apps/web/tests/e2e/sprint-17/remix-dialog.spec.ts  |  64 ++-
 apps/web/tests/e2e/sprint-17/share-dialog-copy.spec.ts | +63 (new)
 apps/web/tests/e2e/sprint-17/variation-dialog.spec.ts |  90 ++-
 infra/scripts/prod-smoke.mjs                       |  93 ++
 infra/scripts/upload-voice-previews.mjs            | +78 (new)
 infra/supabase/migrations/0042_cover_art_bucket.sql| +44 (new)
 packages/co-composer/src/carnatic.ts               |  12 +-
 packages/co-composer/src/dispatcher.test.ts        | +210 (new)
 packages/co-composer/src/hindustani.ts             |  10 +-
 packages/co-composer/src/index.ts                  |  87 +-
 packages/co-composer/src/kannada-folk.ts           |   6 +-
 packages/co-composer/src/kannada-light-classical.ts|   6 +-
 packages/co-composer/src/tamil-folk.ts             |   6 +-
 packages/co-composer/src/western.ts                |  11 +-
 packages/style-presets/src/index.ts                |   8 +-
 services/vocal-synth/scripts/render_voice_previews.py |  51 +-
```

## Pending operator steps (Phase 5 of the plan)

Phase 5 is operational rather than authoring; the items below need
operator hands on the deploy pipeline and the prod browser.

1. Push `fix/v1.4-live-bugs`, open the PR, watch CI (TS, contracts,
   codegen, 9 Python projects) turn green.
2. `git merge --no-ff fix/v1.4-live-bugs` into `main`.
3. `pnpm supabase db push` for the new bucket migration (the
   migration was already applied to prod via MCP during the
   closeout; this step exists to make `supabase migrations` agree
   with reality).
4. Re-run the voice-preview render+upload only if the WAVs were
   ever evicted from the `voice-samples` bucket.
5. After Vercel deploy:
   - `STRICT_V14_AUDIO=0 node infra/scripts/prod-smoke.mjs` — the
     existing smoke must stay green; the two new steps `24a` and
     `24b` will also assert the bucket + voice-preview invariants.
   - Manually probe each of the eight reported bugs end-to-end in
     a browser; append screenshots and the result to this file.
6. POST a queue request for each of `sanskrit-shloka`,
   `telugu-keerthana`, `bengali-rabindrasangeet`, `bollywood-ballad`
   against prod (via the new e2e specs or `infra/scripts/
   smoke-song-create.mjs`); confirm 202.
