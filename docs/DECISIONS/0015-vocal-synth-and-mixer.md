# ADR 0015 — vocal-synth sidecar + worker-side mixer

- Status: Accepted (Sprint 5 — neo-fm v1 finish plan)
- Date: 2026-05-15
- Supersedes / amends:
  - ADR 0010 (vocal stack licensing) — confirms backend choice
  - ADR 0007 (observability) — adds vocal-synth log/metric surface

## Context

Phase 4 shipped instrumental-only HeartMuLa output. The product
promise is **India-first, lyric-aware singing**. We need vocals in
Devanagari/Tamil/Kannada/Telugu/Bengali, time-aligned and mixed on top
of the HeartMuLa instrumental, without giving up:

- The compose-network HMAC boundary (ADR 0003) — no public ingress.
- The single-job pgmq lease model (ADR 0008) — vocal failure of one
  language must not poison the job.
- The deterministic CI story — local `docker compose` and `pytest`
  must work without GPUs or upstream model weights.

There are two real candidate backends:

1. **kenpath/svara-tts-v1** — purpose-built Indic singing-voice
   synthesis, multi-script, multi-language. Default choice.
2. **ai4bharat/indic-parler-tts** — broad Indic TTS coverage; usable
   fallback for languages svara-tts doesn't yet cover well.

Doing inference + mixing inside `music-inference` was rejected for
two reasons: it would conflate the HeartMuLa model server (which we
want hot in GPU memory) with text-to-audio code paths, and it would
break the single-responsibility per service rule we set in ADR 0007.

## Decision

Sprint 5 introduces **two new components**:

1. `services/vocal-synth/` — a FastAPI sidecar on the DGX, reachable
   only over the docker-compose network at
   `http://vocal-synth:8089`. Same HMAC scheme as `music-inference`:
   the worker signs `sha256(body || "\n" || timestamp)` with
   `VOCAL_SYNTH_HMAC_SECRET` and sends
   `X-NeoFM-Signature` + `X-NeoFM-Timestamp`. The sole non-health
   endpoint is `POST /v1/vocalize`, which returns
   `audio/wav` (mono PCM-16, configurable sample rate).
   Backends are pluggable via `VOCAL_MODEL_BACKEND`:
   `svara` (default), `parler`, `fake` (CI), or `auto`.

2. `services/dgx-worker/app/mixer.py` — pure-Python mixer that runs
   inside the worker container. Given one instrumental WAV plus
   N per-language vocal WAVs, it: resamples each input to 48 kHz,
   pads/truncates to the target duration, averages vocal stems,
   side-chain ducks the instrumental from the vocals' envelope,
   soft-compresses, peak-limits to −1 dBTP, and emits stereo 48 kHz
   PCM-16.

The worker fans out vocalize calls **in parallel** (`asyncio.gather`)
across `VOCAL_LANGUAGES`, treats any individual language failure as a
soft error (logs `vocal_lang_failed`, drops that stem, continues),
and falls back to **instrumental-only** if every vocal call fails or
if `VOCAL_SYNTH_URL` is unset. This preserves ADR 0008's "one
non-retryable failure modes per job" rule: a model meltdown on a
single language can't cause job loss.

### Why a soft-failure / partial-render policy?

TRIZ contradiction C15 (vocal coverage vs. job throughput): if any
vocal call fails the job, our error budget is the union of five
language-specific failure rates, which is worse than the instrumental
alone. Soft-failure keeps the job's success probability tied to the
HeartMuLa render's success probability, while letting us add or
remove languages without product-visible churn. Logged failures
remain surfaced through ADR 0007's observability path so the
operator dashboard reflects per-language degradation.

### Why a worker-side mixer and not a third "mixer" service?

The mixer is bounded, deterministic, CPU-only, and runs once per
job. Pulling it out into a third service would add another HMAC
boundary, another health/restart story, and another container start
budget for zero benefit. The mixer's only third-party dep is
`soundfile` + `numpy`, both already present in worker dependency
closure. The mix path is small enough (~200 lines) that unit tests
in `services/dgx-worker/tests/test_mixer.py` give it full coverage.

## Consequences

- `infra/docker-compose.dgx.yml` gains a `vocal-synth` service under
  the `vocal` profile so operators can run instrumental-only stacks
  during weight-pull or GPU-constrained windows.
- The HMAC secret surface doubles: rotate `VOCAL_SYNTH_HMAC_SECRET`
  on the same cadence as `MUSIC_INFERENCE_HMAC_SECRET`.
- `docs/contracts/openapi-vocal-synth.yaml` is the single source of
  truth for the API; any change must regen client structs in
  `services/dgx-worker/app/vocal_client.py`.
- A real DGX render now emits a stereo 48 kHz WAV with mixed
  vocals. The Storage MIME type and signed-URL ladder (ADR 0012)
  are unchanged.

## Operational notes

- Local dev: leave `VOCAL_SYNTH_URL` unset and the worker runs
  instrumental-only. `pytest` paths default to `FakeVocalClient`
  which emits short deterministic WAVs.
- DGX prod: set `VOCAL_MODEL_BACKEND=auto` and
  `NEO_FM_REQUIRE_REAL_MODEL=1`. Vocal-synth will refuse to start
  if it can't load the model — that's the intended fail-fast.
- Per-language failures fire the `vocal_lang_failed` warning log
  with `{job_id, language, err}` — wire that into the Sprint 7
  Grafana alert pack.
