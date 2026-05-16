# Information architecture review (v1.1 deep-dive)

**Date**: Sprint A of v1.1.
**Purpose**: lock vocabulary, decide route taxonomy, map navigation
hierarchy. This is the document the rest of v1.1 (Sprint B–G in
particular) executes against.

## 1. Canonical vocabulary

| Term | Definition | Don't say |
|------|------------|-----------|
| **Song** | The user-facing artifact. One row in `song_documents` + zero or more rendered audio takes. | "Composition", "track", "songdoc". |
| **Take** | A single rendered audio file (one row in `tracks`). A Song can have many Takes (one per regeneration). | "Render", "version" (we'll use "version" only for the v1 spec / API contract version). |
| **Job** | The unit of work in pgmq. One row in `jobs`. A Song has one *active* Job (`queued`/`processing`) at a time. | "Render job", "work item". |
| **Style** | A combination of style family + region. | "Genre" (too broad). |
| **Style family** | One of `western_pop`, `indian_classical`, `indian_folk`. | "Bucket". |
| **Region / style** | Sub-style under a family (`carnatic`, `hindustani`, `kannada_folk`, `pop`, etc.). | "Sub-genre". |
| **Language** | The lyric language code. | "Locale". |
| **Voicing** | Whether the song has vocals (`instrumental`, `vocal`, `harmony`). | "Vocal mode". |
| **Section** | A logical part of a song: `intro`, `verse`, `pre_chorus`, `chorus`, `bridge`, `outro`, `instrumental_break`. | "Segment". |
| **Author** | The user who created the Song. | "Owner" (used in the DB; not in copy). |
| **Handle** | The public username on a profile URL (`/u/[handle]`). | "Username", "alias". |
| **Like** | A 1-bit signal from a user to a Song. | "Heart" (we use the heart **icon** but call the action a Like in copy and APIs). |
| **Follow** | A 1-bit signal between two users. | "Subscribe". |
| **Plan** | Anonymous, Free, Creator, Pro. | "Tier" (DB column is `tier`; copy says Plan). |
| **Quota** | The monthly Song-completion allowance. | "Credit" (reserve for v1.2 billing). |
| **Variation** | A new Song derived from an existing Song's document. | "Remix", "branch". |

## 2. Route taxonomy

Two route groups under the App Router:

- `(marketing)` — anonymous-friendly, SEO-friendly, no React Server Action mutations.
- `(app)` — authed-only, redirects to `/sign-in?next=` for anonymous visitors.

```text
apps/web/app/
├── (marketing)/
│   ├── layout.tsx            ← marketing shell (light theme default, hero nav)
│   ├── page.tsx              ← /
│   ├── pricing/page.tsx      ← /pricing  (Sprint E)
│   ├── help/page.tsx         ← /help     (Sprint E)
│   ├── u/[handle]/page.tsx   ← /u/janedoe (Sprint G)
│   ├── s/[publicId]/page.tsx ← /s/abc123  (existing public share)
│   └── changelog/page.tsx    ← /changelog (deferred to v1.2)
├── (app)/
│   ├── layout.tsx            ← <AppShell> (top + bottom nav, user menu, theme toggle)
│   ├── library/page.tsx      ← /library
│   ├── songs/new/page.tsx    ← /songs/new
│   ├── songs/[id]/page.tsx   ← /songs/abc123-uuid  (Sprint C-c title + Sprint H wow)
│   ├── account/page.tsx      ← /account  (Sprint E)
│   ├── feedback/page.tsx     ← /feedback (Sprint E)
│   ├── discover/page.tsx     ← /discover (Sprint G)
│   ├── onboarding/handle/page.tsx ← first-sign-in handle picker (Sprint G)
│   ├── loading.tsx           ← shared loading boundary
│   └── error.tsx             ← shared error boundary
├── (auth)/
│   ├── sign-in/page.tsx
│   ├── sign-up/page.tsx
│   └── reset/page.tsx        (deferred to v1.2)
├── auth/callback/route.ts    ← (Sprint C) session exchange
└── api/
    ├── songs/
    │   ├── route.ts                  POST create
    │   ├── [id]/route.ts             GET, DELETE
    │   ├── [id]/audio-url/route.ts   GET signed URL  (existing)
    │   ├── [id]/recover/route.ts     POST (Sprint C)
    │   ├── [id]/rename/route.ts      POST (Sprint F)
    │   ├── [id]/stems/route.ts       GET signed URLs (Sprint H)
    │   └── [id]/variation/route.ts   POST (Sprint H)
    ├── discover/route.ts             GET (Sprint G)
    ├── feedback/route.ts             POST (Sprint E)
    └── health/route.ts               GET (Sprint I)
```

## 3. Navigation hierarchy

### 3.1 Top nav (desktop, `(app)` group)

```
[neo-fm logo] [Library] [Discover] [New song]        [search?] [user-menu]
```

- `Library` is `/library` (default after auth).
- `Discover` is `/discover` (Sprint G).
- `New song` is the prominent CTA, in primary color.
- User menu opens: My profile (`/u/[handle]`), Account (`/account`), Feedback (`/feedback`), Help (`/help`), Theme toggle, Sign out.

### 3.2 Bottom nav (mobile, `(app)` group)

Four icons + labels, 48 px tall:

```
[ Home (Library) ] [ Discover ] [ New (FAB-ish) ] [ Profile ]
```

### 3.3 Marketing nav (`(marketing)` group)

```
[neo-fm logo]                            [Pricing] [Help] [Sign in] [Get started]
```

When authenticated, the marketing nav swaps the last two for `[Open app]` -> `/library`. (Sprint B adds the `onAuthStateChange` listener.)

### 3.4 Breadcrumb policy

- `(app)` layout shows breadcrumbs above the page title when depth ≥ 2.
- Examples: `Library > "Sundown drive"`. `Account > Privacy`. `Discover > Carnatic`.

## 4. Page-level information hierarchy

### 4.1 `/library`

1. Quick stats strip: completed songs · in flight · plan badge · quota remaining.
2. Search bar + filter chips + sort dropdown (Sprint F).
3. Song cards grid (3 columns desktop / 1 mobile).
   - Cover art thumbnail (Sprint H AI-generated, 256 px).
   - Title (Sprint C).
   - Style + language sub-line.
   - Audio player with mini spectrogram (Sprint H).
   - Row actions: Play, Like, Share, Rename, Delete, Variation.
4. Pagination: 20 per page (Sprint F).

### 4.2 `/songs/new`

Single canvas:
- **Title** input (Sprint C, top, required).
- **Style** preset chips.
- **Language** toggle (multi-select, max 3).
- **Voicing** toggle.
- **Estimated duration** + section breakdown.
- **Lyrics** (own / public-domain / none).
- Submit -> redirects to `/songs/[id]?from=new`.

### 4.3 `/songs/[id]` detail page

1. Cover art (left, square, AI-generated).
2. Title (H1) + author + style sub-line.
3. Audio player with full-width spectrogram.
4. **Karaoke ticker** synced to audio (Sprint H).
5. Action bar: Play, Like, Share (copy link, open `/s/[publicId]`), Rename (owner only), Make a variation, Stems download, Delete.
6. Section list with **Regenerate this section** (already exists from v1).
7. Sister surfaces: "More from this author" + "Similar style".

### 4.4 `/discover`

1. Hero strip: "Today on neo-fm" — 6 most-liked songs in the last 24 h.
2. Style filters: All · Western · Carnatic · Hindustani · Kannada folk.
3. Feed: paginated, newest first.

### 4.5 `/u/[handle]`

1. Avatar + handle + follower count + Follow button.
2. Bio (free-text, 280 char cap).
3. Published songs grid.

### 4.6 `/account`

Tabbed:
- Profile: handle, display name, bio, avatar.
- Email & password: change email, change password.
- Plan & quota: badge, allowance, upgrade CTA -> `/pricing`.
- Data: export, delete account.

### 4.7 `/pricing` (v1.1 waitlist edition)

- Three tier columns: Free (current) · Creator (coming soon, waitlist) · Pro (coming soon, waitlist).
- Two CTAs to `/feedback?topic=billing`.

## 5. Modal / dialog inventory

- Sign out confirm (top-right user-menu).
- Delete song confirm (library + detail page).
- Delete account confirm (account page; types `delete my account` to enable).
- First-sign-in handle picker (`/onboarding/handle`, full-page modal-feel).
- Onboarding overlay on `/library` first visit (Sprint F): 4-step tour.

## 6. URL state and deep links

- `/library?q=…&style=…&sort=…&page=…` — Sprint F adds these.
- `/discover?style=…&page=…` — Sprint G.
- `/songs/[id]?regen=section-id` — already exists.
- `/sign-in?next=/library` — auth redirect target.

## 7. Loading and skeleton policy

- `(app)/loading.tsx` renders a unified skeleton: header + 3-card placeholder grid + footer.
- Each page can supply its own `loading.tsx` to override (Library does).
- Server actions show inline spinners on their trigger, never replace the whole page.

## 8. Error boundary policy

- `(app)/error.tsx` and `(marketing)/error.tsx` render a friendly card with `request_id` (for support) and a "Try again" button.
- Toast bus is reserved for transient (network) errors.
- Quota-exceeded 429s show a dedicated dialog suggesting upgrade.

## 9. Notification surfaces

- Email: only on job completion (existing) and email confirmation. v1.1 doesn't add more.
- In-app toasts: action confirmations ("Song renamed", "Variation queued"), transient errors.
- No push notifications, no SMS.

## 10. Accessibility commitments

- WCAG AA contrast on every interactive surface (re-audited in Sprint B).
- Logical tab order, `:focus-visible` rings, `aria-live` for job status.
- All form fields have `<label>`s; errors are `aria-describedby` linked.
- Reduced-motion respect on the spectrogram + karaoke ticker (Sprint H).
- Mobile tap targets ≥ 44 px.

## 11. Verdict

The new IA fixes the "every page is an island" problem. Everything in v1.1 derives from this document. Future sprints reference it by section number.
