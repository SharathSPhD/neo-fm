# ADR 0019 — App shell and auth lifecycle

**Status**: Accepted
**Date**: v1.1 Sprint B
**Supersedes**: none. Builds on the implicit per-page-header pattern in v1.

## Context

By the end of v1 every authed page (`/library`, `/songs/new`,
`/songs/[id]`) rendered its own header. The marketing landing page had
its own `SiteHeader` with hard-coded "Sign in / Get started" buttons,
and the marketing nav stayed identical whether or not the visitor was
already authenticated. There was no mobile nav, no theme toggle, no
client-side reaction to auth-state changes (the user could sign in in
another tab and the current tab would still show the marketing nav
until manual refresh).

The user-experienced symptoms reported in v1.1 included:

- "Every page feels like an island; there's no way to get back to the
  library from a fresh tab."
- "I can't tell where I am in the app."
- "Sign-up takes me to a confusing place; after sign-in there's
  nothing to do."
- The (a) bug — signup → email confirmation link → Vercel
  deployment-protection wall — is also exacerbated by the lack of an
  `onAuthStateChange` listener: even when the user does break through,
  the page they land on doesn't refresh its session state.

We need one consistent, auth-aware shell across every authed route
and a single marketing nav across every public-marketing route, plus
a global hook into Supabase's auth lifecycle.

## Decision

1. **Two route groups under the Next.js App Router**:
   - `(app)/` contains every authed page (library, songs/new,
     songs/[id], and Sprint E–G additions). Its layout enforces auth
     (`redirect("/sign-in?next=...")` if no session) and wraps
     children in `<AppShell>`.
   - `(marketing)/` contains every public-marketing page (`/`,
     `/pricing` Sprint E, `/help` Sprint E, `/u/[handle]` Sprint G,
     and the existing `/s/[publicId]`). Its layout reads the session
     server-side and passes `isSignedIn` to `<MarketingNav>`.
   - `(auth)/` is unchanged (existing sign-in / sign-up / sign-out).
2. **A single `<AppShell>`** with:
   - Sticky top nav (desktop ≥ sm).
   - Fixed bottom nav (mobile < sm).
   - User menu (avatar trigger → profile, account, feedback, help,
     theme toggle, sign-out).
   - "New song" CTA in primary color.
3. **Auth-state subscription** via a single `<AuthListener>` mounted
   in the root layout. On `SIGNED_IN` / `SIGNED_OUT` /
   `TOKEN_REFRESHED` / `USER_UPDATED` it calls `router.refresh()` so
   the RSC tree picks up the new cookie state.
4. **Theme system**:
   - Dark by default; light theme available via `<ThemeToggle>`.
   - Persisted in `localStorage` under `neo-fm:theme`.
   - Boot script (`public/theme-boot.js`) loaded via Next.js `<Script
     strategy="beforeInteractive">` to avoid flash-of-wrong-theme.
   - CSS variables in `globals.css` swap on `:root[data-theme="light"]`.
5. **Boundaries**:
   - `(app)/loading.tsx` and `(app)/error.tsx` provide the default
     skeleton + error card for every authed page.
   - `(marketing)/loading.tsx` and `(marketing)/error.tsx` cover the
     public surfaces.
   - Pages may still ship their own `loading.tsx` / `error.tsx` for
     specific routes.
6. **Empty states + breadcrumbs**: `<EmptyState>` and `<Breadcrumbs>`
   primitives in `components/` so every page can drop them in with
   one import. The IA review (`docs/REVIEWS/info-architecture.md`)
   defines when to use them.

## Consequences

### Positive

- Every authed page now has the same nav. The user-reported
  "everything is an island" stops at v1.1.
- Mobile becomes usable for the first time (bottom nav + 48 px tap
  targets in the spec).
- Cross-tab auth sync (open library tab + sign in elsewhere → tab
  refreshes itself).
- Theme toggle takes one line per page (none — it's in the shell).
- Loading/error boundaries are uniform; adding a new page costs
  nothing extra.

### Negative

- Route groups physically move existing pages, which means open
  branches with parallel work need to rebase. We coordinate this in
  the operator-handoff doc.
- Boot-script-via-static-file means anyone who hard-disables JS sees
  the default (dark) theme on hard reload — acceptable.
- The `<AppShell>` reads `users.handle` which doesn't exist until
  Sprint G; the `fetchShellUser` helper handles that gracefully (the
  query catches the PostgREST 400 and re-selects without `handle`).

### Neutral

- No new dependencies. Pure React + Tailwind.
- The user menu is a popover; it does not yet use Radix or
  headless-ui because the focus management here is small enough to
  hand-roll. If we add Sprint H modals (cover-art preview, stem
  download) we re-evaluate.

## Implementation map

| File | Purpose |
|------|---------|
| `apps/web/components/app-shell.tsx` | Server-rendered shell |
| `apps/web/components/user-menu.tsx` | Client popover |
| `apps/web/components/theme-toggle.tsx` | Client toggle + storage key export |
| `apps/web/components/marketing-nav.tsx` | Server-rendered marketing nav |
| `apps/web/components/auth-listener.tsx` | Client onAuthStateChange → router.refresh |
| `apps/web/components/breadcrumbs.tsx` | Server primitive |
| `apps/web/components/empty-state.tsx` | Server primitive |
| `apps/web/public/theme-boot.js` | Static boot script |
| `apps/web/app/layout.tsx` | Mounts `<Script>`, `<AuthListener>` |
| `apps/web/app/(app)/layout.tsx` | Auth + shell |
| `apps/web/app/(app)/loading.tsx` | Skeleton |
| `apps/web/app/(app)/error.tsx` | Error boundary |
| `apps/web/app/(marketing)/layout.tsx` | Marketing nav |
| `apps/web/app/(marketing)/loading.tsx` | Skeleton |
| `apps/web/app/(marketing)/error.tsx` | Error boundary |

## Open follow-ups (for v1.1 later sprints)

- Active-nav highlighting via `usePathname()` (already supported as
  an `active` prop; Sprint C-c wires it per-page).
- Toast bus (Sprint F).
- Page-level "X jobs in progress" indicator (Sprint F).
- Visit-tracked "first-time-here" onboarding overlay (Sprint F).
