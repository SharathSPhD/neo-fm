# ADR 0020: Vocal-synth multi-backend routing + post-render quality eval

Status: Accepted (Sprint D, v1.1 deep-dive)

## Context

The first user report after we shipped v1 included a specific
complaint:

> "Probably you need to work more on TTS and phonetics to match the
> language, music style etc."

The v1 vocal-synth service had three weaknesses that conspired to
produce the user's experience:

1. **Single backend**. Every section, regardless of language or
   script, went through `kenpath/svara-tts-v1`. Svara is excellent
   for Indic singing in native scripts but mediocre for Hinglish
   (Hindi written in Latin) and unhappy with English.
2. **No text preprocessing**. The service shipped raw section
   lyrics to the model. Decomposed Unicode, ZWJ / ZWNJ artefacts,
   and Hinglish spellings all reached the tokeniser, where they
   were silently corrupted.
3. **No quality signal**. Once a render finished, we had no way to
   know whether the model had produced a clean vocal stem, an OOM
   silence, or a wandering octave-jumping hallucination. The
   orphan-reconciler (Sprint C-b) had to treat every "completed"
   job as good.

## Decision

We split vocal synthesis into three concerns and wire them in this
order:

### 1. Preprocessing (`app/preprocess.py`)

Every section's text passes through a pure-Python pipeline before
hitting any model:

- Unicode NFC normalisation
- ZWJ / ZWNJ stripping (only when the producer did not supply
  `transliteration` — that field is the producer's escape hatch)
- Halant / virama double-collapse for Devanagari, Kannada, Tamil,
  Telugu
- Hinglish Roman → IPA hint substitution (`th → tʰ`, `aa → aː`,
  ...) wrapped in `[ipa:...]` brackets that Parler-TTS recognises
  as a phoneme hint
- Prosody markers: `tempo:<bpm>`, `slow` / `fast`, `sustain` on
  long vowels
- Utterance segmentation to ≤ 80 chars on sentence-final
  punctuation, then hard-chunked

The pipeline returns `(PreparedUtterance[], PreprocessTrace)`. The
trace is logged at INFO so a user-reported regression can be
attributed to a specific normalisation step.

### 2. Routing (`app/routing.py`)

`RoutingVocalModel` picks one backend per section using these rules
(first match wins):

1. `instrumental` or empty text → `fake` (cheap silence)
2. `language == "en"` → `parler` (Svara is Indic-only)
3. script == `latin` (Hinglish) → `parler` (Latin-script Indic;
   Parler's voice descriptors carry pronunciation hints)
4. otherwise → `svara`

Backends load lazily on first hit. If a load fails and
`NEO_FM_REQUIRE_REAL_MODEL=1`, the routing model re-raises;
otherwise it falls back to `FakeVocalModel` for that segment. The
fallback is instantiated lazily — `FakeVocalModel.__init__` refuses
to construct under `NEO_FM_REQUIRE_REAL_MODEL=1`, so eager
construction would break the prod path.

The router preserves the existing `VocalModel` Protocol so the rest
of vocal-synth (FastAPI surface, metrics exporter, mixer) does not
change.

### 3. Post-render evaluation (`app/eval.py`)

We compute three signals on the rendered mono WAV:

- **Voicing ratio**: fraction of frames above an RMS gate
- **Pitch stability**: 1 − bounded ZCR variance (gated by voicing
  to avoid silent renders trivially scoring high)
- **Tempo adherence**: when `tempo_bpm` was requested, score the
  log2 ratio of estimated onsets/min to requested

Blended weights: `voicing × 0.6 + stability × 0.3 + tempo × 0.1`.
The result is `overall_score ∈ [0,1]` written to
`public.tracks.vocal_eval_score` (migration 0018) alongside
`vocal_backend` and `vocal_model_version`.

### 4. Telemetry (migration 0018)

Three nullable columns on `public.tracks` + a `recent_vocal_quality`
view that surfaces the last 1000 scored renders for the Sprint J
Grafana panel. NULL on legacy rows; new renders fill them in.

## Consequences

**Positive**

- Hinglish renders go through Parler-TTS with IPA-hinted text;
  early benchmarks suggest 2–3× higher voicing_ratio than the v1
  Svara-only path on `language=hi, script=latin` content.
- Quality regressions are detectable: any render with
  `vocal_eval_score < 0.3` is a candidate for the reconciler to
  re-enqueue automatically (Sprint J).
- Native-script Indic content keeps using Svara — no regression
  risk for the existing well-supported path.
- The preprocessing trace gives us a structured artifact for
  reproducing bug reports.

**Negative**

- Loading two transformers backends doubles the GPU memory
  pressure when both are in use within a song. We mitigate by
  loading each lazily and by relying on the GPU governor (ADR
  0016) to pre-empt vocal-synth when music-inference needs the
  card.
- Parler-TTS is gated behind an optional dep (`parler_tts`); the
  Dockerfile installs it but unit tests skip it via the
  `tts` extras group.
- Three new columns on `tracks`; minimal storage impact (< 100
  bytes per row), no index changes.

## Alternatives considered

- **One model per language family**. Rejected: language alone
  doesn't capture the Hinglish case, which is `language=hi` but
  needs Parler.
- **Server-side cascading retry** (try Svara, eval, retry on
  Parler if score < threshold). Rejected for v1.1 — doubles the
  inference cost on every miss. Worth revisiting once we have
  utilisation data.
- **Make the user pick the backend**. Rejected: the router should
  not be a UI surface; this is a craft detail the user shouldn't
  have to think about.

## Implementation map

- `services/vocal-synth/app/preprocess.py` (new)
- `services/vocal-synth/app/parler.py` (new)
- `services/vocal-synth/app/routing.py` (new)
- `services/vocal-synth/app/eval.py` (new)
- `services/vocal-synth/tests/test_preprocess.py` (new, 10 cases)
- `services/vocal-synth/tests/test_routing.py` (new, 7 cases)
- `services/vocal-synth/tests/test_eval.py` (new, 5 cases)
- `infra/supabase/migrations/0018_vocal_telemetry.sql`
- DGX worker hookup: a follow-on PR persists `vocal_backend`,
  `vocal_model_version`, and `vocal_eval_score` on insert_track.

## Open questions

- **Eval threshold for auto-retry**: 0.3 is a guess; we'll set it
  empirically once Sprint J ships the Grafana panel and we can see
  the score distribution on real renders.
- **Backend mix tracking**: the router records `last_decisions` in
  memory; if we ever need per-section telemetry in the DB, we'll
  promote it to `tracks.section_routes jsonb`.
