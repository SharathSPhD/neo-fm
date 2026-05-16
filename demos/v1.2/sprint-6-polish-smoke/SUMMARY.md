# Sprint 6 polish — Playwright production smoke

**Status:** ✅ Green (all 8 checks pass)
**Deployment:** `dpl_3E49ZAC2j5yEGKUdgTFznXsgo64m` (commit `df80359`, branch `v1.2-bugfix-pack`, aliased to `neo-fm-web.vercel.app`)
**Smoke user:** `e2e-smoke@neo-fm.test` (Creator tier from Sprint 5c smoke)
**Smoke script:** `/tmp/smoke/polish-smoke.mjs` (mirrored intent below; checked-in copy lives in `infra/scripts/` once Sprint 7 lands)

## Phase-5 gate – evidence

| Feature | Check | Pass | Evidence |
|---|---|---|---|
| Library grid (6.2) | Grid view is the default | ✅ | `01-library-grid.png` — `aria-pressed="true"` on Grid button |
| Library grid (6.2) | List toggle updates `?view=list` | ✅ | `02-library-list.png` — URL changes, layout flips to list rows |
| Cmd-K palette (6.1) | Palette opens on Ctrl+K | ✅ | `03-command-palette.png` — `[cmdk-root]` visible; Navigate + Recent Songs groups rendered |
| Cmd-K palette (6.1) | Typing + Enter navigates | ✅ | "Disc" + Enter → URL becomes `/discover` |
| Discover grid (6.2) | Public cover-art grid renders | ✅ | `04-discover-grid.png` |
| Remix (6.3) | `POST /api/songs/{id}/remix` 202 | ✅ | `remix POST 202 {"job_id":"78cf4b76…", "remixed_from":"5d789339…"}` |
| Remix (6.3) | Navigation lands on new job | ✅ | URL changes from `/songs/5d78…` → `/songs/78cf…` |
| Remix (6.3) | "Remixed from {title}" backlink | ✅ | `06-remix-detail.png` shows "Remixed from Western in English — 2026-05-15 (remix)" |

DB verification:

```sql
select id, status, remixed_from from public.jobs where id = '78cf4b76-bd5f-42ac-af8c-e87e734913b2';
-- → remixed_from = '5d789339-1927-4039-a5f4-b8493f087507' (the parent)
```

## Defects found and fixed during smoke

1. **Lineage stamp silently failed.** First smoke run showed `remix-creates-job PASS` but `remix-shows-backlink FAIL`. The API was reporting `remixed_from` in its JSON, but the DB column stayed `NULL`. Root cause: `public.jobs` has only SELECT + DELETE RLS policies (no UPDATE), so the user-scoped `update().eq("id", …)` silently affected 0 rows. **Fix:** switched the lineage stamp to the service-role client, narrowed to `(id=new_job AND user_id=caller)` so this can't be abused to backfill onto someone else's job. The route now returns `remixed_from` only when at least one row was actually updated. Tests added to mock `createServiceRoleClient` and assert the stamp went through.

2. **Onboarding modal intercepted toolbar clicks.** Fresh browsers see `LibraryOnboardingModal` which sits at `z-50` and blocks pointer events to the view-toggle pair. Smoke pre-flags `localStorage["neo-fm:library-onboarded"]="1"` via `addInitScript` before navigating. Real users dismiss with the "Got it" button on first mount.

3. **First `/songs/<href>` was `/songs/new`.** The library list links include the "New song" CTA. Selector tightened to `a[href^="/songs/"]:not([href="/songs/new"])` so the smoke always picks a UUID-shaped song, not the CTA.

4. **cmdk DialogTitle warning.** Added a `title` prop to `<Command.Dialog>` (cmdk 1.1.1 forwards it to the underlying Radix DialogTitle). The matching `Description` dev-mode warning is left as-is — cmdk 1.1.1 doesn't accept a `description` prop, and the message is dev-mode-only.

## Manual deploy note

Deployment used `npx vercel deploy --prod --yes` from the repo root after re-linking the Vercel CLI to project `neo-fm-web` (the previous session's local link had drifted to a stray `web` project). The GitHub auto-deploy on `main` is still pending the v1.2 merge; until then, this is the source of truth for the production alias.

## Follow-ups

- [ ] After v1.2 merges to main, re-run this smoke once more as part of the final-gate sweep.
- [ ] Consider adding a `jobs_update_own` RLS policy in a follow-up migration so future write paths don't need to fall back to service-role.
- [ ] Open an upstream issue / PR on cmdk for the missing `description` prop in 1.1.x.
