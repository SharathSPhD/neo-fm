-- v1.5: Allow manifest.json uploads to the voice-samples bucket.
--
-- The render_voice_previews.py script uploads a manifest.json alongside
-- the WAV files so the web picker can distinguish real Parler-TTS previews
-- from FakeVocalModel placeholders without relying on Content-Length alone
-- (both produce 960 044-byte files for 10s × 48kHz mono audio).

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/json')
where id = 'voice-samples'
  and not ('application/json' = any(allowed_mime_types));
