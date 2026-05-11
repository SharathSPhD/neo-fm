# ADR 0005: Audio storage retention and tier byte caps

Status: Accepted

## Context

`tracks.url` points at Supabase Storage objects. With three tiers, no payments
in v1, and a "well under 1 ¢ per track" cost story, storage growth is the
single biggest hidden variable. A user generating 30 songs/day at 3 min,
WAV-16, mono, 44.1 kHz, ≈10 MB each, fills 300 MB/day, or 9 GB/month, per
user. At 100 active users that's 900 GB/month — Supabase free tier caps at
1 GB.

We need an honest retention policy before Phase 4 ships any storage writes.

## Decision

**Storage format**: render to WAV (lossless) for QA; deliver MP3 192 kbps
(≈2.5 MB / 3 min) to the user-facing signed URL by default. Free tier never
sees the WAV. WAV is retained only for paid tiers.

**Per-tier byte caps** (enforced at `POST /api/songs` by computing the
delta cost against current usage):

| Tier    | Total bytes  | Track formats served | Retention                              |
| ------- | ------------ | -------------------- | -------------------------------------- |
| free    | 500 MB       | MP3 only             | rolling 30 days (oldest auto-deleted)  |
| creator | 5 GB         | MP3 + WAV            | rolling 180 days                       |
| pro     | 50 GB        | MP3 + WAV + FLAC     | indefinite while subscription active   |

**Signed URL TTL**: 1 hour for free, 24 hours for creator/pro. Renewal
endpoint refreshes (no permanent public URL anywhere).

**Garbage collection**: a Supabase Edge Function runs nightly, finds
`tracks` rows older than the tier's retention window, deletes both the
Storage object and the row. Soft-delete (`deleted_at`) for 7 days before
hard-delete so accidental loss is recoverable.

**On tier downgrade**: oldest tracks beyond the new cap are soft-deleted
immediately; user gets an email.

## Consequences

- Free tier total cost is bounded: 500 MB × 100 users = 50 GB at peak, well
  inside Supabase paid-tier pricing if free runs over the 1 GB free cap.
- WAV retention scales with paying users only, where the storage cost is
  covered by the subscription.
- Signed URLs are short-lived enough that leaked URLs are not a content
  redistribution channel.
- `tracks` table grows a `format`, `bytes`, `deleted_at`, and `expires_at`
  column starting in the Phase 4 schema; ADR 0008 (pgmq leases) is the
  sibling decision for jobs.
- Phase 4 must include a billing-bytes view (`v_user_storage_bytes`) used by
  the create-song handler before enqueue.
