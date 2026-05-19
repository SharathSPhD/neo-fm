-- 0049_seed_songs_add_target_seconds.sql
--
-- Seed song documents were created without target_seconds in each section.
-- The Python SongDocument Pydantic model requires it (sum must equal
-- target_duration_seconds). The DGX worker validation fails on every seed
-- job, preventing the discover feed from populating.
--
-- Fix: for any section in a public discover-seed song_document that is
-- missing target_seconds, distribute target_duration_seconds evenly across
-- all sections in that document.
--
-- Idempotent: the EXISTS subquery only matches documents that still have
-- at least one section without target_seconds.

UPDATE public.song_documents sd
SET document_json = (
  SELECT jsonb_set(
    sd.document_json,
    '{sections}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN s ? 'target_seconds' THEN s
          ELSE s || jsonb_build_object(
            'target_seconds',
            (sd.document_json->>'target_duration_seconds')::int
              / jsonb_array_length(sd.document_json->'sections')
          )
        END
      )
      FROM jsonb_array_elements(sd.document_json->'sections') AS s
    )
  )
)
FROM public.jobs j
WHERE j.song_document_id = sd.id
  AND j.published_visibility = 'public'
  AND j.status IN ('processing', 'queued')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(sd.document_json->'sections') AS sec
    WHERE NOT (sec ? 'target_seconds')
  );
