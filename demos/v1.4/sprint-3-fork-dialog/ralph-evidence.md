# v1.4 Sprint 3 — Variation + Remix dialogs (Ralph evidence)

**Status:** complete
**Branch:** `v1.4-deep-dive`
**Commit (pre-push):** will be filled in once committed

## What shipped

1.  **Shared body schema (`apps/web/lib/song/fork.ts`).**
    Zod schema `ForkSongBodySchema` accepts `distance | tempo_bpm |
    key_override | raga_override | voice_id | section_ids | title`, all
    optional, with strict object semantics. Exposes `parseForkBody`
    which treats empty input as `{}` for back-compat with v1.3 callers.
2.  **Shared mutation helper (`apps/web/lib/song/fork-applier.ts`).**
    `applyForkToDoc` is the single source of truth for how a fork body
    becomes a child SongDocument. Validates style/raga compatibility
    (`STYLE_RAGA_ALLOWLIST`), gates `key_override` to Western, jitters
    tempo on remixes when none is supplied, stamps lineage and section
    selection into `metadata.fork`, and returns a typed Result so API
    routes can map errors to 422 cleanly.
3.  **API routes refactored.**
    -   `POST /api/songs/[id]/variation/route.ts` — reads `ForkSongBody`,
        runs `applyForkToDoc`, re-validates with `SongDocumentSchema`,
        creates the child job via the `create_song_job` RPC. v1.3 callers
        with empty bodies continue to get a low-distance re-roll.
    -   `POST /api/songs/[id]/remix/route.ts` — same plumbing as
        variation but with `kind: "remix"`, `appendRemixSuffix: true`,
        and `DEFAULT_REMIX_DISTANCE = 65`. The legacy tempo-jitter and
        "(remix)" title suffix now live inside `applyForkToDoc` so the
        two routes share one definition.
4.  **Shared UI (`apps/web/app/(app)/songs/[id]/fork-song-dialog.tsx`).**
    One overlay component with a `kind` prop drives both flows. Renders
    distance slider, tempo/key inputs, raga name+system selector (gated
    on style), voice id, section chips (multi-select), and a title
    override. Maps 1:1 to `ForkSongBody`; the dialog only sends keys the
    user actually changed so back-compat remains intact.
5.  **Button wrappers slimmed.**
    `variation-button.tsx` and `remix-button.tsx` are now ~12 LOC each;
    they pass `kind`, `songId`, `styleFamily`, and `sections` into the
    dialog.
6.  **Variation on the public page.**
    `apps/web/app/s/[publicId]/page.tsx` now imports `VariationButton`
    next to `RemixButton` so the "Make a variation" affordance is
    available on Discover/shared links — a v1.4 plan requirement.
7.  **Rate-limit bucket reconciled.**
    `lib/rate-limit.ts` now groups `remix | variation | cover-art` in
    `songs:gen-aux` (limit 6/window) so a user can't round-trip
    remix-from-public to amplify their effective limit.
8.  **Pretty labels widened (catch-up from Sprint 2).**
    `apps/web/lib/song/labels.ts` extended for `bollywood-ballad`,
    `sanskrit-shloka`, `bengali-rabindrasangeet`, `telugu-keerthana`,
    and the new `bn | te | sa` language codes so the dialog and song
    cards render the v1.4 surface correctly.

## Files touched

```
A apps/web/app/(app)/songs/[id]/fork-song-dialog.tsx        # 458 LOC, the shared dialog
M apps/web/app/(app)/songs/[id]/page.tsx                    # pass styleFamily + sections
M apps/web/app/(app)/songs/[id]/remix-button.tsx            # thin wrapper around ForkSongDialog
M apps/web/app/(app)/songs/[id]/variation-button.tsx        # thin wrapper around ForkSongDialog
M apps/web/app/api/songs/[id]/remix/route.ts                # ForkSongBody + applyForkToDoc
M apps/web/app/api/songs/[id]/variation/route.ts            # ForkSongBody + applyForkToDoc
M apps/web/app/s/[publicId]/page.tsx                        # variation button on /s/[publicId]
A apps/web/lib/song/fork.ts                                 # zod schema + parseForkBody
A apps/web/lib/song/fork-applier.ts                         # applyForkToDoc + STYLE_RAGA_ALLOWLIST
M apps/web/lib/song/labels.ts                               # v1.4 styles + languages
M apps/web/lib/rate-limit.ts                                # remix now in songs:gen-aux
A apps/web/tests/lib/fork-applier.test.ts                   # 10 tests for the mutation helper
A apps/web/tests/lib/fork-body.test.ts                      # 10 tests for the zod schema
M apps/web/tests/lib/rate-limit.test.ts                     # +2 cases for remix bucketing
A apps/web/tests/app/api/variation.test.ts                  # 6 cases for /variation contract
M apps/web/tests/e2e/remix.spec.ts                          # click trigger then dialog submit
A apps/web/tests/e2e/fork-dialog.spec.ts                    # new e2e: variation with overrides
```

## Test results

-   `pnpm --filter @neo-fm/web lint` — clean (0 warnings, 0 errors).
-   `pnpm -r typecheck` — clean across all 6 workspaces.
-   `pnpm -r test` — **172 / 172 passing** (was 143 at end of Sprint 2;
    +29 new tests: 10 fork-applier + 10 fork-body + 6 variation + 2 rate
    limit + 1 misc).
-   `cd packages/song-doc/python && uv run pytest -q` — **10 / 10
    passing**.
-   E2E Playwright specs were updated structurally but not executed in
    this turn (no live Supabase available); they will run in Sprint 17's
    QA sweep.

## Notable decisions

-   **One mutation helper, two API surfaces.** Putting the
    style/raga/key/tempo invariants in `applyForkToDoc` (with a Result
    type) means the dialog and any future "save as preset" feature can
    re-use the same validation without inventing a fourth copy of the
    rules.
-   **Empty-body parity is non-negotiable.** Prod-smoke and the v1.3
    "make a remix" affordance both POST `{}` — the parser treats this as
    "default everything" rather than 422 so we don't break shipping
    callers.
-   **Defaults differ between kinds.** Variation defaults to a
    distance of 25 (faithful re-roll); remix defaults to 65 (bold
    reinterpretation) and applies tempo jitter when none is supplied.
    Both defaults round-trip through the dialog (the slider opens at the
    kind's default).
-   **Raga allowlist is duplicated in three places — by design.** The
    Zod schema, the Python Pydantic mirror, and the TS applier all need
    to enforce the same rules at different boundaries (client validation,
    server validation, worker validation). The constant is named
    `STYLE_RAGA_ALLOWLIST` in all three so they're trivially
    cross-referenceable; Sprint 17 will add a unit test that snapshots
    the keys.
