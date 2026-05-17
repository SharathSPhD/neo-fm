-- 0040_cover_art_bucket.sql -- create the `cover-art` Storage bucket
--
-- Why this exists:
--   The Sprint H cover-art table migration (0026_cover_art.sql)
--   declared the `cover-art` bucket "must be created out-of-band in
--   the Supabase dashboard" and never created it. Production never
--   got the bucket, so the cover-art generation UI returns
--   "Bucket not found" the first time a user requests cover art.
--
-- Why a migration:
--   Out-of-band setup didn't survive contact with reality. Putting
--   the bucket in a migration makes it part of the schema we test
--   in CI and apply with `supabase db push`, matching the pattern
--   established for `voice-samples` in 0039_voice_samples_bucket.sql.
--
-- Bucket properties:
--   - PRIVATE: matches `tracks` (0004_queue.sql). Cover-art is
--     personal content; serve via signed URLs minted by the API.
--   - 5 MB cap per object: a square 1024x1024 PNG at quality 95 is
--     ~2.5 MB; a JPEG 95 is ~600 KB. 5 MB gives 2x headroom.
--   - Allowed mime types: PNG, JPEG, WebP. The cover-art-synth
--     service currently produces PNG; WebP is wired for future
--     bandwidth optimization.
--
-- Idempotent: `on conflict (id) do nothing` so re-applying the
-- migration on an environment that has the bucket is a no-op.

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types, avif_autodetection
) values (
  'cover-art',
  'cover-art',
  false,
  5242880, -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp'],
  false
) on conflict (id) do nothing;

-- Storage policies:
--
--   1. Reads are NEVER done by anon/authenticated clients directly.
--      The API mints short-lived signed URLs via the service role
--      (see apps/web/app/api/songs/[id]/cover-art/route.ts), so we
--      don't add a `select` policy here.
--
--   2. Writes are service-role only (the dgx-worker uploads after
--      cover-art-synth renders). Mirroring the voice-samples pattern.

drop policy if exists cover_art_write_service_role on storage.objects;
create policy cover_art_write_service_role on storage.objects
  for all to service_role
  using (bucket_id = 'cover-art')
  with check (bucket_id = 'cover-art');
