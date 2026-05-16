# Competitive research -- v1.2 polish picks

Date: 2026-05-16
Sprint: v1.2 Sprint 4
Author: agent (compounded by user direction)

## Why this exists

The user asked for "research other web apps (music and non-music), learn
about some key features, and incorporate them" into v1.2. This document
captures the targeted look across four buckets (AI music, music creator
tooling, product UX leaders, India-first consumer apps), scores the top
candidates against Effort/Impact, and recommends three polish features
for Sprint 6.

The doc is small on purpose: each bucket gets a focused observation
list, not an exhaustive feature dump. Anything not in the shortlist is
parked under "Deferred" with a one-line note.

## 1. AI music apps

### Suno (https://suno.com)

What I lifted from Suno's surface:

- **Cover-art-first feed**. The library and the public explore feed
  are tile grids. Each card is a generated cover image first, title
  second, style tag third. Drives a "browse like Pinterest" feeling
  rather than "scan like email". Our v1.1 list view feels heavy.
- **Make a remix / variation as a first-class CTA**. Every public
  song shows a prominent "Make my own" button that pre-fills the
  creation canvas with the source song's style, tempo, raga, and
  visible attribution to the original. This is the single biggest
  viral loop in the product.
- **Daily / weekly creative prompts** on the explore page. A
  rotating "today's theme" gives lapsed users a low-friction reason
  to come back.
- **Persistent player at the bottom of the page**. The currently
  playing track follows the user across navigation. Big deal for a
  music app -- you don't lose your place when reading lyrics.
- **Real lyric editor with section markers**. Inline syllable
  counter and "regenerate this verse" buttons per section.

### Udio (https://udio.com)

- Even stronger emphasis on **continuations**: "extend this song by
  60 seconds" is a primary verb. The creation canvas is built around
  iteration, not first-shot generation.
- **Side-by-side A/B compare** for two takes of the same prompt. A
  diff view but for audio. High polish.
- **Cover-art-led cards** like Suno, but the hover state reveals
  waveform thumbnails. Tells the user at a glance whether the song
  is busy or sparse without playing it.

### Riffusion, Mubert, Soundraw, ElevenLabs Music

- Smaller surfaces, fewer cross-cutting ideas worth lifting.
- ElevenLabs Music has a clean "style chooser" pattern -- a grid of
  example tiles you click instead of an open prompt. We already have
  this via the preset gallery in Sprint 2; we matched the pattern
  before reviewing it.

## 2. Music creator tooling

### BandLab (https://bandlab.com)

- **Drafts and autosave** at the project level. Users open a project
  and start editing without an explicit "new" flow; the file is
  there next time. Reduces the activation cost of the first song.
- **Versions per project**. Multiple takes live under one project
  with names like "vocal pass 2 (warmer)". Lower fear of
  destructive edits.
- **Project metadata page** -- title, artwork, BPM, key, notes --
  separate from the editor. Easier to scan than embedding
  everything in the song doc.

### Splice (https://splice.com)

- **Click-to-seek waveform** under every audio player. Trivial to
  add, dramatically improves "scrub-through" feel vs the default
  HTML5 audio bar.
- **Sample-pack-style discovery** -- categorize by mood, key, tempo,
  and let users filter the catalog like a music library. We do part
  of this on Discover already; tightening the filter UI would help.
- **Loop region selection**. Drag two markers on the waveform to
  loop a section. Niche but valuable for review.

## 3. Product UX leaders (non-music)

### Linear (https://linear.app)

- **Command palette (Cmd+K)** is the spine of the app. Every action
  is reachable from one keystroke. Power users live in it; new
  users discover it via the "?" cheat sheet.
- **Keyboard shortcuts everywhere** with consistent muscle memory
  (C to create, G then L for go-to-library equivalents).
- **Optimistic UI** for every mutation. Likes, status changes,
  rename -- the UI commits immediately and reconciles on response.
- **Skeleton loaders** vs spinners. Skeletons trace the shape of
  the content, spinners just say "something is happening".
- **Empty states with concrete next actions**. The Inbox empty
  state has a "Set up filters" button; the Roadmap empty state has
  "Create your first project". Never a bare "Nothing here."

### Cursor (https://cursor.com)

- Same Cmd+K spine.
- **Two-pane editor with the chat pinned to the right**. The chat
  is treated as a first-class workspace, not a sidebar overlay.
  Discoverable because every chat-eligible action shows the
  shortcut.

### Vercel dashboard

- **Deployment-as-card** layout. Every deployment is a tile with
  status, timing, and the actor right on the surface. The card *is*
  the deep link.
- **Inline copy-to-clipboard** on every ID, URL, env var. The
  affordance is everywhere; you never have to triple-click.

## 4. India-first consumer apps

### PhonePe (https://phonepe.com)

- **Locale-aware currency formatting** with the rupee symbol prefix
  and Indian digit grouping (`1,23,456`). We use `Intl.NumberFormat`
  via the `en-IN` locale; this is now table stakes for an India-
  first app.
- **Vernacular toggle** on the landing page (English / Hindi /
  Kannada / others). Used by a meaningful chunk of users.

### CRED (https://cred.club)

- **Premium feel from typography and motion**. CRED proves that
  "fintech can be aspirational" with serif-display headings and
  generous whitespace. Not a feature, a posture, but the v1.1 type
  scale already leans this way.
- **Trust signals embedded in the surface** (verified-badge,
  reward-progress meter). Hooks for our future "verified creator"
  badge if we go social.

## 5. Top-10 scored shortlist

Effort 1-5 (5 = hardest), Impact 1-5 (5 = highest). Score is
`Impact * (6 - Effort)`. Higher score = better return.

| # | Feature | Source | Effort | Impact | Score |
| --- | --- | --- | --- | --- | --- |
| 1 | Cover-art-first Library + Discover grid | Suno, Udio | 2 | 5 | 20 |
| 2 | Command palette (Cmd+K) global | Linear, Cursor | 2 | 4 | 16 |
| 3 | Remix / variation primary CTA | Suno, Udio | 3 | 5 | 15 |
| 4 | Drafts + autosave per song | BandLab | 2 | 3 | 12 |
| 5 | Click-to-seek waveform under players | Splice | 2 | 3 | 12 |
| 6 | Optimistic UI for likes / favorites | Linear | 1 | 2 | 10 |
| 7 | Empty-state CTAs with concrete actions | Linear, Vercel | 1 | 2 | 10 |
| 8 | Daily / weekly creative themes | Suno | 3 | 3 | 9 |
| 9 | Inline lyric editor with regen-per-section | Suno, Udio | 3 | 3 | 9 |
| 10 | Vernacular UI toggle (Hindi/Kannada) | PhonePe | 4 | 3 | 6 |

## 6. Top-3 recommendations (Sprint 6)

Pick by score, plus a sanity check that the three reinforce each other
rather than fighting for the same screen real estate:

### Top pick: Cover-art-first Library + Discover grid (score 20)

- v1.1 already generates AI cover art via the
  `generate-cover-art` Edge Function (Sprint H). The covers exist;
  the surface that uses them does not.
- Adds visual identity to the product without changing any backend.
- Pure frontend refactor + a list/grid toggle so power users keep
  density when they want it.

### Second pick: Command palette (Cmd+K) (score 16)

- Power-user spine. Linear and Cursor users will reach for Cmd+K on
  reflex; we should not punish them.
- Self-documents the shortcut surface; surfaces actions even
  novice users don't know exist (rename, favorite, recover).
- Wraps existing actions, no new backends.

### Third pick: Remix this song (score 15)

- The single biggest viral loop in Suno's product.
- Requires one migration (`remixed_from` column + RLS), one API
  route, and one button on the song detail page. Tight blast radius.
- Composes cleanly with the cover-art grid: a remixed song's card
  can show the source attribution as a subtle overlay.

## 7. Deferred (parked, not lost)

- **Persistent player at bottom of the page**. Suno's killer
  feature; medium-effort because of `<audio>` lifecycle gotchas
  across Next.js navigation. Worth a v1.3 sprint.
- **Drafts + autosave**. Compelling, but the v1.1 model treats
  every song as final; needs a schema change to add a `status =
  'draft'` enum value and a "Resume editing" surface.
- **Click-to-seek waveform**. Cheap; can ride alongside the v1.1
  live spectrogram in a small follow-up.
- **Daily creative themes**. Needs a curation pipeline; not v1.2.
- **Inline lyric editor with section regen**. Already partly
  delivered by v1.1 Sprint H section-regen endpoint; needs a UI
  pass.
- **Vernacular UI toggle**. Material; needs an `i18n` library and
  a glossary. v1.3 candidate.
- **Optimistic UI everywhere**. Easy wins; will fold these into the
  Sprint 6 cover-art grid as I touch the components.
- **Empty-state CTAs**. Same -- I'll harvest these opportunistically
  while touching pages.

## 8. Next step

Confirm the top-3 picks (Cover-art grid, Cmd+K, Remix) via the
follow-up AskQuestion, then move to Sprint 5 (Stripe) so Sprint 6 can
land with the upgrade UI already in place.
