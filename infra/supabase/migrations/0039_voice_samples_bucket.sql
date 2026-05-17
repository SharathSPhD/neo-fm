-- v1.4 Sprint 5: public `voice-samples` Storage bucket for the 16 voice
-- previews exposed by the voice picker on /songs/new. Each preview is a
-- 10s WAV rendered by `services/vocal-synth/scripts/render_voice_previews.py`
-- and uploaded under `samples/<voice_id>.wav`. The bucket is public so the
-- browser can stream previews without a signed URL round-trip; writes are
-- restricted to the service role (operator runs the script with
-- SUPABASE_SERVICE_ROLE_KEY).

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types, avif_autodetection
) values (
  'voice-samples',
  'voice-samples',
  true,
  10485760, -- 10 MB cap per WAV (10s @ 48k mono is ~960 KB; 10x margin)
  array['audio/wav', 'audio/x-wav'],
  false
) on conflict (id) do nothing;

-- Read access: the bucket is public so the CDN serves objects without
-- RLS. We deliberately do NOT add a broad `select` policy on
-- storage.objects because that would let clients list every file in
-- the bucket (advisor: public_bucket_allows_listing). Object-by-name
-- access via the public URL works regardless.

-- Insert / update / delete: service role only. The render script always
-- authenticates as service role; no other path should write here.
drop policy if exists voice_samples_write_service_role on storage.objects;
create policy voice_samples_write_service_role on storage.objects
  for all to service_role
  using (bucket_id = 'voice-samples')
  with check (bucket_id = 'voice-samples');
