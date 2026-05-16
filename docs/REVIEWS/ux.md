# UX review (v1.1 deep-dive)

**Date**: Sprint A of v1.1.
**Scope**: every route reachable from production. Walked through as a
new signed-in user, an existing user with songs, and an anonymous
visitor on a phone screen.

## 1. The five jobs to be done

1. **Land** -> understand what neo-fm is in 8 seconds.
2. **Sign up** -> get into the app in under 60 seconds without confusion.
3. **Create** -> make a first song without writing a JSON document by hand.
4. **Wait + listen** -> see status, then play, then share.
5. **Come back** -> find old songs, make a variation, share with friends.

## 2. Surface-by-surface findings

### 2.1 `/` (landing) — Sprint 8 ship

- ✅ Hero, three value props, gallery from `style-presets`, "How it works", sign-up CTA.
- ❌ Nav bar shows "Sign in / Get started" even when the visitor is already authenticated. Wastes screen real estate and looks broken on repeat visits.
- ❌ No way to read the changelog or roadmap from here. Users have no proof we ship.
- ❌ Style preset cards only show a label; no audio preview. Promise without proof.
- Fix: Sprint B auth-aware nav listener; Sprint G adds short audio teasers (15 s clips) to preset cards.

### 2.2 `/sign-up` and `/sign-in`

- ✅ Forms are minimal, no clutter.
- ❌ Sign-up never sets `emailRedirectTo`; the link lands on Vercel deployment-protected URL (user-reported bug a).
- ❌ No "show password" toggle; failure messages are generic.
- ❌ No password strength meter.
- ❌ After sign-up, the success state says "check your email" but there's no resend-email link, and no guidance for spam.
- Fix: Sprint C wires `emailRedirectTo` + `/auth/callback` route. Sprint I adds password meter + show/hide toggle. Sprint C adds "Resend confirmation email" link.

### 2.3 `/library` — the home for returning users

- ❌ Header is duplicated per page; no global nav. User has no way back to `/songs/new` or out to `/discover`.
- ❌ Each card shows the truncated job id (`ASCII characters`, user-reported bug c) instead of a human title.
- ❌ A `completed` job without a tracks row reads "Audio URL pending…" forever (bug b).
- ❌ No search, no filter, no sort, no pagination. 50-row default. At 51 songs, the user is stuck.
- ❌ No rename, no delete, no favorite. Songs are append-only and indistinguishable.
- ❌ No empty state for first-time users (just a blank list).
- ❌ Auto-refresh is silent; no visible "X jobs in progress" indicator at the page level.
- Fix: Sprint F overhauls list management; Sprint C fixes titles and orphan recovery; Sprint B ships nav.

### 2.4 `/songs/new` — the creation canvas

- ✅ Style preset chips, language toggle, voicing toggle.
- ❌ No title input.
- ❌ The "Sample lyrics from public domain" toggle is buried; first-time users don't know they can use it.
- ❌ The "Estimated duration" is hidden until you scroll; it's the single most important affordance.
- ❌ No autosave; refresh loses the draft.
- ❌ No "duplicate from existing song" path.
- Fix: Sprint C adds title input. Sprint F adds duplicate-from-existing. Future v1.2 adds autosave + drafts.

### 2.5 `/songs/[id]` — the detail page

- ❌ This route doesn't exist in production today; deep-link from email is a 404.
- ❌ No way to share a song after creation without going back to library.
- Fix: Sprint C-c renders title in the title; Sprint H ships karaoke ticker, AI cover art, variation button, stem download.

### 2.6 `/s/[publicId]` — the public share

- ✅ OG card renders; signed URL surface is correct.
- ❌ No like, no follow, no comments — feels like a tombstone.
- ❌ Title is the truncated id (bug c).
- Fix: Sprint C-c title fix; Sprint G likes + share helpers; Sprint H AI cover art for OG.

### 2.7 Mobile

- ❌ No bottom nav. On a phone, every navigation requires the top nav, which is a wall of links.
- ❌ Tap targets on `/library` cards are 36 px high (below the 44 px iOS HIG floor).
- ❌ Forms don't use `autocomplete`, `inputmode`, or `enterkeyhint`. Sign-up keyboard isn't optimized for email.
- Fix: Sprint B ships mobile bottom nav + 48 px tap targets; Sprint C adds form a11y.

### 2.8 Errors

- ❌ Network failures show generic "Something went wrong". No retry button on transient failures.
- ❌ Quota exhaustion error 429 is rendered as raw JSON in some surfaces.
- ❌ No global toast system.
- Fix: Sprint B ships shared loading/error boundaries + a toast bus; Sprint F wires API failures into the toast bus.

### 2.9 Empty states

- ❌ `/library` empty state is literally an empty list.
- ❌ `/discover` doesn't exist yet.
- ❌ `/u/[handle]` doesn't exist yet.
- Fix: Sprint B ships `<EmptyState>` primitive; Sprint F + G fill it in with copy + CTAs.

### 2.10 Accessibility

- ❌ Tab order on `/songs/new` skips the language toggle.
- ❌ Focus rings are absent on Tailwind-generated buttons (button reset wipes them).
- ❌ Color contrast on the muted gray (`hsl(240 5% 64.9%)`) against the dark background is 3.8:1 — under WCAG AA.
- ❌ No `aria-live` region for job status changes.
- ❌ Form errors are shown but not announced to screen readers.
- Fix: Sprint B brings focus-visible rings as part of global styles; bumps muted-foreground to 4.7:1; adds `aria-live="polite"` on library rows.

### 2.11 Copy

- ❌ "Songs", "Compositions", "Tracks", "Songdoc" are used interchangeably across the surfaces.
- ❌ Some validation errors talk in Zod-speak ("Expected string, received undefined").
- Fix: Sprint A locks the vocabulary in `docs/REVIEWS/info-architecture.md`; Sprint B propagates to UI.

## 3. The user-reported bugs, in UX language

- (a) "I signed up and the link goes to a Vercel login wall." -> Sprint C.
- (b) "Yesterday's song never finished, today's did." -> Sprint C orphan recovery + Recover button.
- (c) "Why does my song's title look like a hash?" -> Sprint C song title.
- (d) "The Hindi vocals sound weirdly Anglo." -> Sprint D TTS rewrite + ParlerTTS routing.

## 4. The five most consequential v1.1 UX moves

1. **App shell with auth-aware nav** (Sprint B). Single line of changes per page; massive perception change.
2. **Song titles** (Sprint C). Tiny schema change, large information-density win.
3. **Library list management** (Sprint F). Turns a dump into a workbench.
4. **Public discover feed** (Sprint G). Songs leave isolation. Word of mouth becomes possible.
5. **Karaoke ticker + AI cover art + spectrogram** (Sprint H). Three crowd-pleasers; cheap to implement, large emotional payoff.

## 5. Verdict

The product is competent under the hood and clumsy on the surface. v1.1 is a UI/UX sprint masquerading as a hardening sprint, and that is by design.
