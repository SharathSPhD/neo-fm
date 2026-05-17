# v1.4 Sprint 4 — Background-music UX (Ralph evidence)

**Status:** complete
**Branch:** `v1.4-deep-dive`

## What shipped

The creation canvas now exposes the full SongDocument surface area via
an "Advanced" disclosure, the user can save the current configuration
as a personal preset, and the catalogue layer ships the 12-raga +
8-tala + per-style instrument shortlist that the dialog reads from.

### Pieces

1.  **`packages/co-composer/src/raga-catalogue.ts`** —
    12-raga + 8-tala catalogue + per-style instrument shortlist.
    Exports `RAGA_CATALOGUE`, `TALA_CATALOGUE`, `INSTRUMENT_CATALOGUE`,
    `ragasForStyle`, `talasForSystem`, `findRaga`. Re-exported from
    `@neo-fm/co-composer`'s entrypoint so the web app can import it
    without grabbing a deep path.
2.  **`apps/web/app/(app)/songs/new/advanced-disclosure.tsx`** — the
    overlay controls: tempo slider, key picker (Western-only), raga
    picker (auto-fills system + suggested tala from the catalogue),
    tala picker, orchestration editor (lead-vocal radio + instrument
    chips + texture), density + dynamics radios, free-form section
    tags textarea, live JSON preview, "Save as my preset" button.
3.  **`apps/web/app/(app)/songs/new/creation-canvas.tsx`** — folds the
    disclosure state into `buildSongDocument`, exposes
    `applyAdvancedOverrides` as a pure helper for tests, posts to
    `/api/user-presets` for the save action. Widens StyleFamily/Language
    unions to include the v1.4 additions (bollywood, rabindrasangeet,
    keerthana, shloka + bn/te/sa) so they show up in the simple form
    even before their dedicated co-composers land.
4.  **Migration `0038_user_presets.sql`** — new `public.user_presets`
    table with RLS scoped to `auth.uid()`. Two SECURITY DEFINER RPCs:
    `save_user_preset(p_title, p_song_document)` enforces title trim +
    120-char cap + 20-per-user limit (sqlstate `23505` → HTTP 409);
    `delete_user_preset(p_preset_id)` enforces ownership.
5.  **`apps/web/app/api/user-presets/route.ts` + `[id]/route.ts`** — GET
    (list under RLS), POST (save via RPC), DELETE (delete via RPC).
    Full status code mapping: 401 unauth, 400 malformed JSON, 422
    validation, 409 cap reached, 403 forbidden, 404 not found, 500 on
    unknown DB error.
6.  **`docs/DECISIONS/0024-creation-canvas-controls.md`** — local ADR
    documenting the industry analogues (Suno-Custom / Udio-Advanced /
    Boomy), the disclosure vs separate-route rationale, and why
    `user_presets` is a separate table from `style_presets`.

### Files touched

```
A packages/co-composer/src/raga-catalogue.ts           # 197 LOC, 12 ragas + 8 talas
A packages/co-composer/src/raga-catalogue.test.ts      # 10 cases
M packages/co-composer/src/index.ts                    # re-export raga catalogue
A apps/web/app/(app)/songs/new/advanced-disclosure.tsx # 458 LOC, the disclosure UI
M apps/web/app/(app)/songs/new/creation-canvas.tsx     # state plumbing + buildSongDocument
A apps/web/app/api/user-presets/route.ts               # GET + POST
A apps/web/app/api/user-presets/[id]/route.ts          # DELETE
A apps/web/lib/supabase/database.types.ts              # regenerated for 0038 RPCs
A infra/supabase/migrations/0038_user_presets.sql      # table + RPCs
A apps/web/tests/lib/advanced-overrides.test.ts        # 13 cases (applyAdvancedOverrides, parseSectionTagsRaw, buildSongDocument)
A apps/web/tests/app/api/user-presets.test.ts          # 9 cases (GET/POST/DELETE)
A apps/web/tests/e2e/advanced-disclosure.spec.ts       # e2e (Sprint 17 run)
A docs/DECISIONS/0024-creation-canvas-controls.md      # local ADR
```

## Test results

-   `pnpm --filter @neo-fm/co-composer test` — **77 / 77** (10 new for
    the raga catalogue).
-   `pnpm --filter @neo-fm/web lint` — clean.
-   `pnpm -r typecheck` — clean across 6 workspaces.
-   `pnpm -r test` — **194 / 194** web tests (was 172 at end of
    Sprint 3; +22 = 13 advanced-overrides + 9 user-presets).
-   `cd packages/song-doc/python && uv run pytest -q` — **10 / 10**.

## Notable decisions

-   **Disclosure folds, default closed.** First-time users see exactly
    the same minimal form they did in v1.3; power users open the
    panel. Matches Suno-Custom's "advanced toggle" idiom.
-   **`metadata.key` not `key` top-level.** Mirrors the ForkSongDialog
    convention from Sprint 3 so the worker reads it through one path
    regardless of whether the value came from creation, fork, or remix.
-   **Catalogue raga auto-fills system + tala.** Picking "Yaman" from
    the dropdown also stamps `system: "hindustani"` and
    `tala: "teentaal"`. The user can override either field afterward.
-   **Personal presets cap at 20.** Sized for the gallery grid; the RPC
    raises sqlstate `23505` which the API maps to HTTP 409 so the
    front-end can show a precise "you've hit your cap" message.
-   **Tag textarea parses `key:value` only.** Lines without `:` are
    skipped so we never silently feed prose into the composer's
    single-valued tag-merge.
-   **Section-level tag append, not replace.** The textarea's tags are
    appended to every section's existing tag bag; server-side
    tag-merge dedupes against single-valued families.
-   **Style + language widening.** The simple form now lists every
    v1.4 family even before their dedicated co-composers land. Routing
    falls back to the closest existing composer (Sprint 2 wiring).

## Supabase advisors (delta)

`get_advisors(security)` returns the same WARN floor as Sprint 3 plus
two new entries — `anon_security_definer_function_executable` and
`authenticated_security_definer_function_executable` — for
`save_user_preset` and `delete_user_preset`. These match the existing
v1.3 pattern (`toggle_favorite`, `publish_song`, `submit_feedback`):
the functions are SECURITY DEFINER so RLS does not block the
ownership-narrowed mutation, and they themselves raise `not_authenticated`
when `auth.uid()` is null. No new ERROR-level advisories.
