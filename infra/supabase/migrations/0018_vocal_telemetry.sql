-- 0018_vocal_telemetry.sql -- vocal model + eval score telemetry (Sprint D)
--
-- ADR 0020 splits vocal synthesis across two real backends + a fake.
-- Without telemetry the bug report "the singing sounds wrong" has no
-- handles. We add three nullable columns to public.tracks:
--
--   - vocal_backend       text  -- 'svara' | 'parler' | 'fake' | 'mixed'
--   - vocal_model_version text  -- e.g. 'kenpath/svara-tts-v1@abc1234'
--   - vocal_eval_score    float -- overall_score from app.eval.evaluate_wav
--
-- The worker fills these in alongside the storage upload. The
-- support page (Sprint F) will surface the score so users can flag
-- low-quality renders for retry, and the orphan-reconciler can use
-- vocal_eval_score < threshold as a signal to mark a job 'failed'
-- and re-enqueue instead of leaving it in 'completed'.

alter table public.tracks
  add column if not exists vocal_backend text;

alter table public.tracks
  add column if not exists vocal_model_version text;

alter table public.tracks
  add column if not exists vocal_eval_score double precision;

alter table public.tracks
  drop constraint if exists tracks_vocal_eval_score_range_ck;
alter table public.tracks
  add constraint tracks_vocal_eval_score_range_ck
  check (vocal_eval_score is null or (vocal_eval_score >= 0 and vocal_eval_score <= 1));

comment on column public.tracks.vocal_backend is
  'Which vocal-synth backend produced this stem: svara | parler | fake | mixed (set by RoutingVocalModel).';
comment on column public.tracks.vocal_eval_score is
  '0..1 quality signal from app.eval.evaluate_wav. NULL on legacy rows. Low scores feed the reconciler''s retry decision.';

-- Make the new fields visible to the metrics views Sprint J builds.
create or replace view public.recent_vocal_quality as
  select
    t.created_at,
    t.job_id,
    j.user_id,
    t.vocal_backend,
    t.vocal_model_version,
    t.vocal_eval_score,
    sd.language,
    sd.style_family
  from public.tracks t
  join public.jobs j on j.id = t.job_id
  left join public.song_documents sd on sd.id = j.song_document_id
  where t.vocal_eval_score is not null
  order by t.created_at desc
  limit 1000;

comment on view public.recent_vocal_quality is
  'Most recent 1000 rendered tracks with vocal eval scores attached. Powers the Sprint J Grafana panel.';

grant select on public.recent_vocal_quality to service_role;
