-- 0044_cover_art_bucket_allow_svg.sql
--
-- The cover-art-template route (apps/web/app/api/songs/[id]/cover-art-template/route.ts)
-- renders a deterministic SVG and uploads it with contentType "image/svg+xml".
-- Migration 0042 created the cover-art bucket with allowed_mime_types limited to
-- PNG/JPEG/WebP — written independently of the SVG template feature, causing
-- "image/svg+xml is not supported" upload errors on every template render.
--
-- Fix: append image/svg+xml to the bucket's allowed MIME list.
-- SVGs from the template are small (< 4 KB), well within the 5 MB file_size_limit,
-- and served only via signed URLs so there is no public MIME-sniffing risk.
--
-- Idempotent: the NOT (...= ANY(...)) guard makes re-application a no-op.

UPDATE storage.buckets
SET allowed_mime_types = array_append(allowed_mime_types, 'image/svg+xml')
WHERE id = 'cover-art'
  AND NOT ('image/svg+xml' = ANY(allowed_mime_types));
