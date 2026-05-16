# Sprint 1 — Privacy lockdown + commercial framing

**Status:** ✅ green
**Branch:** `v1.3-wedge` (parent: `main` @ `d9f4862`)
**Author:** v1.3 wedge plan (auto)

## What shipped

1. **Marketing landing (`apps/web/app/(marketing)/page.tsx`)**
   - Removed hero "View source ↗" anchor.
   - Removed footer `github.com/SharathSPhD/neo-fm` link, `Apache-2.0` string,
     and "Made with HeartMuLa-OSS-3B · Indic vocals by kenpath/svara-tts-v1".
   - Replaced the "Not a TTS hack" value-prop wording with composition-aware
     product language.
   - Footer now shows year + product positioning + three nav links
     (`/pricing`, `/help`, `/feedback`) — no engine credit, no repo link.
2. **Help page (`apps/web/app/(marketing)/help/page.tsx`)**
   - Rewrote every FAQ entry to drop `HeartMuLa`, `Svara-TTS`, `Parler-TTS`,
     `DGX`, `ADR ####`, and "Sprint #" references; copy is now in
     product/customer language.
3. **New-song page (`apps/web/app/(app)/songs/new/page.tsx`)**
   - "We'll route it to the DGX" → "We'll render it on our engine".
4. **Health endpoint (`apps/web/app/api/health/route.ts`)**
   - Anonymous callers get `version: "production"` and `commit: null`.
   - Internal callers (Supabase auth cookie present OR
     `Authorization: Bearer $HEALTH_INTERNAL_TOKEN`) get the rich payload
     (`version: v1.3-wedge`, 7-char commit SHA). Reachability checks and
     status reporting are unchanged for all callers.
   - New unit suite `tests/app/api/health.test.ts` (6 cases) covers all
     four code paths: anon, token-match, token-mismatch, sb-auth-cookie,
     unrelated-cookie, and missing-env.
5. **`.gitignore`**
   - Added `docs/` and `voice-tts.md`. Working-tree copies kept locally;
     stop pushing them to the remote.
   - Ran `git rm -r --cached docs/` — 53 files removed from the index,
     0 files removed from disk.
6. **GitHub repo visibility**
   - `gh repo edit SharathSPhD/neo-fm --visibility private` → repo is now
     `PRIVATE`. Marketplace / Vercel GitHub integration continues to work
     against a private repo for the same SSO'd account.
7. **Code comments**
   - Scrubbed internal product names (`HeartMuLa`) from three server-side
     comments (`/api/songs`, `/api/songs/[id]/variation`,
     `tests/app/api/songs.test.ts`) so the Ralph grep gate is genuinely
     zero across `apps/web/{app,components}`. License field in
     `apps/web/package.json` is untouched (build artefact, not
     user-visible).

## Out of scope (surfaced as follow-up)

- **History rewrite of past `docs/*` commits.** Sprint 1 stops pushing
  new doc edits to the remote but does NOT force-push to scrub history,
  because that would break Vercel deploy lineage. If we want a full
  scrub, that's a separate, owner-approved force-push operation.

## Ralph gate

See [`ralph-evidence.md`](./ralph-evidence.md) for the captured commands
and outputs. All four gate checks are green:

| Check                                                                    | Result        |
|--------------------------------------------------------------------------|---------------|
| `grep -riE 'github\.com\|heartmula\|svara-tts\|parler-tts\|apache-2\|view source\|kenpath' apps/web/{app,components}` | zero hits ✅ |
| `gh repo view --json visibility`                                         | `PRIVATE` ✅  |
| `git ls-files docs/ \| head`                                             | empty ✅      |
| Working-tree `docs/` still present locally                               | yes ✅        |

## Test sweep

| Suite                                                | Result               |
|------------------------------------------------------|----------------------|
| `pnpm --filter @neo-fm/web typecheck`                | green                |
| `pnpm --filter @neo-fm/web lint`                     | green                |
| `pnpm --filter @neo-fm/web test` (vitest, 14 files)  | 103/103 + 6 new = 109 ✅ |

## Open follow-ups (intentionally deferred)

1. `/api/health` anonymous-vs-internal contract will be re-verified
   against production at the end of Sprint 6 — once Vercel ships the
   v1.3 build, an anon `curl https://neo-fm-web.vercel.app/api/health`
   must report `"version":"production"` and `"commit":null`.
2. `HEALTH_INTERNAL_TOKEN` is *optional* — when unset, only the
   sb-auth-cookie path unlocks the rich payload. Provisioning a value in
   Vercel production env is a follow-up if we want runbook scripts to
   call `/api/health` without a browser session.
