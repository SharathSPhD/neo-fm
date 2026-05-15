# ADR 0013 — Public share surface for completed songs

- **Status**: accepted
- **Sprint**: 3
- **Owner**: cloud
- **Related**: ADR 0005 (storage policies), ADR 0007 (observability), ADR 0012 (signed-URL playback)

## Context

Until Sprint 3 a song was only viewable by its owner under `/songs/[id]`
behind a Supabase session. To make the product feel like a real launch
surface — and so a user can show a friend or post a song without making
them sign up — we need a publicly addressable URL per song.

Constraints:

1. **Privacy by default.** Existing songs must stay private. A song
   becomes shareable only when the owner explicitly publishes it.
2. **Stable links.** Once a song is published the URL must survive
   unpublish/re-publish so links shared elsewhere don't rot.
3. **Owner controls revocation.** If the owner sets visibility back to
   `private` the public page must immediately stop rendering.
4. **No bucket exposure.** The `tracks` storage bucket must remain
   private — there is no acceptable trade-off where rendered audio is
   addressable without a signed URL.
5. **Owner-friendly, agent-friendly UX.** The detail page needs a
   share modal; the URL scheme must look like `/s/<id>` for OG cards
   and `/s/<id>/embed` for iframe embeds (Substack, Notion, etc.).
6. **OG cards work without a signed-in client.** Slack, X, iMessage,
   Discord, and link previews fetch the page anonymously; the
   `<meta>` tags and the OG image must resolve without auth.

## Decision

### URL surface

| Path                         | Auth   | Purpose                                              |
| ---------------------------- | ------ | ---------------------------------------------------- |
| `/s/[publicId]`              | none   | Server-rendered public song page                     |
| `/s/[publicId]/embed`        | none   | Minimal iframe-friendly playback view                |
| `/s/[publicId]/opengraph-image` | none | Dynamic OG image (PNG, 1200x630)                  |
| `/api/p/[publicId]`          | none   | JSON `{ public_id, song_document, status }`         |
| `/api/p/[publicId]/audio-url` | none  | Mints a 1h signed audio URL (ADR 0012 Tier 1+2)     |
| `/api/songs/[id]/publish`    | owner  | `POST { visibility }`. Mints `public_id` on first publish |

### Schema (migration `0013_public_songs.sql`)

`public.jobs` gains three columns plus an enum:

```sql
song_visibility_enum := 'private' | 'unlisted' | 'public'

jobs.public_id              text       unique, nullable
jobs.published_at           timestamptz, nullable
jobs.published_visibility   song_visibility_enum, default 'private'
```

- `public_id` is a 10-char Crockford base32 slug (~50 bits entropy)
  minted by `gen_public_id()` on first publish; reused on republish.
- A partial unique index `(public_id) where public_id is not null`
  guarantees uniqueness without preventing many `null`s.
- A composite index on `(published_visibility, published_at)` is used
  by future `/explore` pages and by the share modal's "recently
  published" hint.

### `publish_song(p_job_id, p_visibility)` RPC

`SECURITY DEFINER`, callable by `authenticated` only. Enforces:

1. caller is the song owner;
2. song status is `completed` (no publishing failed/queued jobs);
3. visibility is one of the enum values.

On first publish it loops up to 8 times against the unique index to
mint a fresh `public_id`. On republish it reuses the existing slug.

### RLS widening

Three new policies allow anonymous + authenticated `SELECT` against
`jobs`, `song_documents`, and `tracks` **only** when the parent job
has `published_visibility in ('public', 'unlisted')`. Insert / update
/ delete policies are unchanged.

The bucket policy is **intentionally not widened.** Public visitors
get a fresh signed URL minted by `GET /api/p/[publicId]/audio-url`
using the service-role key (server-only). This route uses ADR 0012's
two-tier strategy: the page mints a Tier-1 URL inline; the
`<SongAudio>` client falls back to this endpoint when an URL expires
mid-session.

### Visibility semantics

| Visibility | RLS public read | Listed on /explore (future) | Shareable link works |
| ---------- | --------------- | ---------------------------- | -------------------- |
| `private`  | no              | no                           | no (404)             |
| `unlisted` | yes             | no                           | yes                  |
| `public`   | yes             | yes                          | yes                  |

`unlisted` is the default when the owner clicks "Share" — they have to
opt in to `public` (which exposes the song on a future browse surface).

### Search bots / abuse

The public page emits `<meta name="robots" content="noindex,nofollow">`
for `unlisted` and `index,follow` for `public`. The `/s/[publicId]`
route caps content with `Cache-Control: public, max-age=60,
stale-while-revalidate=300` to keep load light without making revoke
take more than a minute to propagate.

The `/api/p/[publicId]/audio-url` route returns `Cache-Control:
no-store` (signed URLs are 1h TTL; we never want a CDN serving a stale
one).

## Consequences

### Implementation

1. New migration `0013_public_songs.sql` (applied).
2. `apps/web/app/s/[publicId]/page.tsx` — server-rendered public page
   with OG metadata and `<SongAudio>` for playback.
3. `apps/web/app/s/[publicId]/embed/page.tsx` — minimal iframe.
4. `apps/web/app/s/[publicId]/opengraph-image.tsx` — dynamic PNG.
5. `apps/web/app/api/p/[publicId]/route.ts` — JSON payload.
6. `apps/web/app/api/p/[publicId]/audio-url/route.ts` — signed URL.
7. `apps/web/app/api/songs/[id]/publish/route.ts` — owner publish.
8. `apps/web/app/songs/[id]/share-button.tsx` — modal on detail page.

### Rollback

The migration is additive. If the share surface is removed we drop the
three policies, the RPC, and the three columns; existing private songs
are unaffected. Existing minted `public_id` values can be cleared with
`update jobs set public_id = null, published_visibility = 'private'`.

### Open questions deferred to Sprint 8+

- Custom slugs (`/s/anandi-bhairavi`) — pending validation against the
  fact that we don't yet have a name field on songs.
- Per-share access codes / expiry — not implemented; today
  `published_visibility = 'private'` is the only revocation path.
- Counting plays / referrers — Sprint 7 (observability) gates this.
