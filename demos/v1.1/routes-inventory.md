# v1.1 route inventory

Surfaces added or substantively reworked in the v1.1 deep-dive.
Sprint markers point back to `docs/OPERATOR-HANDOFF.md` §2.

## Marketing / unauthenticated

| Path | Sprint | Purpose |
| --- | --- | --- |
| `/` | 8 (v1) | India-first landing page |
| `/discover` | G | Public feed of recently published songs |
| `/pricing` | E | Tier table with waitlist CTAs |
| `/help` | E | Static FAQ + links to feedback / pricing |
| `/feedback` | E | Anonymous + authed feedback form (`POST /api/feedback`) |
| `/s/[publicId]` | 3 (v1) | Public song page with OG card + share modal |
| `/embed/[publicId]` | 3 (v1) | Embeddable iframe player (CSP `frame-ancestors *`) |
| `/u/[handle]` | G | Public profile (handle, join date, follower count, songs) |
| `/auth/callback` | C (a) | Exchanges email-confirmation code for session |

## Authenticated app

| Path | Sprint | Purpose |
| --- | --- | --- |
| `/library` | F | Search + filter + sort + paginate + favorite / rename / delete + onboarding modal |
| `/songs/new` | 1 (v1) | Create surface with style preset gallery |
| `/songs/[id]` | 2 (v1) + H | Detail page; v1.1 adds spectrogram, stems panel, cover art panel, karaoke ticker, "Make a variation" button |
| `/account` | E | Plan badge, password reset, data export, account delete |
| `/onboarding/handle` | G | Pick / change public handle |

## API

### Anonymous-writable (anon RPCs gated by SECURITY DEFINER)

| Route | Sprint | Notes |
| --- | --- | --- |
| `POST /api/feedback` | E | Rate-limit `anon:feedback` 6/min |
| `POST /api/waitlist` | E | Rate-limit `anon:waitlist` 10/min |
| `GET /api/health` | I | Structured health + Supabase + Upstash probe |
| `GET /api/healthz` | 0 (v1) | Lightweight liveness probe |
| `GET /api/p/songs/[publicId]` | 3 (v1) | Public song row |

### Authenticated

| Route | Sprint | Notes |
| --- | --- | --- |
| `POST /api/songs` | 1 (v1) | Create job (`create_song_job` RPC) |
| `GET /api/songs/[id]` | 1 (v1) | Detail |
| `DELETE /api/songs/[id]` | F | Cascade delete |
| `GET /api/songs/[id]/audio-url` | 2 (v1) | Signed URL |
| `POST /api/songs/[id]/publish` | 3 (v1) | Mint public_id |
| `POST /api/songs/[id]/recover` | C (b) | Re-queue stuck job |
| `POST /api/songs/[id]/rename` | F | Rename via `rename_song` RPC |
| `POST /api/songs/[id]/favorite` | F | Toggle via `toggle_favorite` RPC |
| `POST /api/songs/[id]/like` | G | Toggle via `toggle_like` RPC |
| `GET/POST /api/songs/[id]/stems` | H | List + tier-gated download |
| `GET/POST /api/songs/[id]/cover-art` | H | List + tier-gated generation |
| `POST /api/songs/[id]/variation` | H | Seed a sibling job |
| `POST /api/songs/[id]/sections/[sectionId]/regenerate` | 2 (v1) | Section regen |
| `POST /api/users/[id]/follow` | G | Toggle via `toggle_follow` RPC |
| `POST /api/account/handle` | G | `claim_handle` RPC |
| `GET /api/account/export` | E | JSON dump of user data |
| `DELETE /api/account` | E | Calls `admin.deleteUser` |
| `GET /api/me` | 1 (v1) | Profile, quotas, tier |
| `GET /api/lyrics/library` | 2 (v1) | Built-in lyric library |

## Middleware behavior

All requests above pass through `apps/web/middleware.ts`:

1. **Rate limit**: `pickRule(pathname)` selects a bucket; an Upstash
   or in-memory counter rejects with 429 once limit/min/IP is
   exceeded.
2. **Session refresh**: `supabase.auth.getUser()` touches the
   cookie unless the path is `/api/health(z)`.
3. **Security headers**: HSTS, CSP, X-Content-Type-Options,
   Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy,
   X-Frame-Options (DENY by default, omitted for `/embed/*`).
