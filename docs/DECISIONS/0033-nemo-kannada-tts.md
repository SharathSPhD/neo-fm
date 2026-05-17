# ADR 0033: Custom NeMo Kannada TTS backend

**Status:** Accepted
**Date:** 2026-05-17
**Sprint:** v1.4 Sprint 13

## Context

Kannada is one of the four primary languages neo-fm targets (the
other three being Hindi, Tamil, and Telugu). Indic Parler-TTS and
IndicF5 both speak Kannada, but the v1.4 plan calls for a
**custom NeMo FastPitch + HiFi-GAN model** trained on 20–100 hours
of curated Kannada speech so the two `indic_kn_*` personas
(`indic_kn_male_warm`, `indic_kn_female_bhajan`) match
neo-fm's bhavageete / sugama-sangeetha aesthetic more tightly than
a general-purpose pretrained model can.

Sprint 12 deliberately kept those two personas on Parler — see
ADR 0032 — so this sprint becomes a focused two-persona flip on
top of the routing layer landed in S12.

## Decision

We add `app/nemo.py` as the **fourth real backend** behind
`RoutingVocalModel` (after Svara, Parler, IndicF5). Routing
changes:

  - `BackendKey` widens to include `"nemo"`.
  - `_pick_backend(section)` adds one rule: if a section's
    `voice_id` resolves to a catalogue entry with
    `backend == "nemo"`, return `"nemo"`.
  - `RoutingVocalModel.__init__` accepts a `nemo=` argument
    (defaulting to `NeMoTTSModel(env-ids)`), tracks
    `_nemo_loaded`, and `_ensure_backend("nemo")` applies the
    same soft-fallback dance Sprints D / 12 already proved out.
  - The 2 `indic_kn_*` catalogue entries flip from `parler` to
    `nemo`.

Training + corpus tooling lives in:

  - `scripts/curate_kannada_tts.py` — corpus curation pipeline
    that walks a configurable raw-audio root, applies VAD, runs
    WhisperX for alignment + diarisation, filters by speaker
    cluster, and emits a NeMo manifest JSONL. Dry-run mode emits
    synthetic manifests so CI can lock the schema.
  - `scripts/train_kannada_nemo.py` — wraps NeMo's FastPitch +
    HiFi-GAN recipe (two stage train: mel-spec then vocoder).
    Dry-run mode writes placeholder `.nemo` artifacts plus a
    speaker map JSON so CI exercises the file-layout contract.

Both scripts run **only on DGX-Spark** per the DGX-only rule
established in ADR 0023; HuggingFace is used solely to push the
final `.nemo` checkpoints to a private repo for ops to pull onto
the production node.

### Why NeMo (FastPitch + HiFi-GAN) and not a single end-to-end model

  - FastPitch is the NeMo recipe with the largest Indic-language
    track record (NVIDIA published Hindi and Telugu reference
    models on NGC). The acoustic + vocoder split keeps each stage
    debuggable: a bad HiFi-GAN run can be re-trained while the
    expensive FastPitch stage is reused.
  - The two-persona target means the speaker-conditioned
    multi-speaker FastPitch recipe applies directly — one model
    handles both `indic_kn_male_warm` (speaker 0) and
    `indic_kn_female_bhajan` (speaker 1). The speaker-map JSON
    pins this contract so we don't accidentally swap voices after
    a retrain.
  - An end-to-end model (e.g. VITS) would compress training time
    but lose the ability to swap the vocoder when we later add
    finer-grained breath / vibrato control for the bhajan persona.

### MOS proxy column for NeMo

The Sprint 12 benchmark harness already has four backend columns
(`svara`, `parler`, `indicf5`, `nemo`). In Sprint 12, the `nemo`
column was a placeholder `FakeVocalModel` in dry-run. In Sprint 13
the harness now actually loads `NeMoTTSModel` (still backed by a
fake inner module in CI because `nemo_toolkit` isn't installed in
the CI image) and emits four real columns. The DGX-side real-mode
run swaps in the trained `.nemo` artifacts and produces the
canonical bhavageete bake-off table.

### Why not just flip those personas to IndicF5

We considered keeping `indic_kn_*` on IndicF5 and skipping NeMo
entirely. Rejected because:

  - The bhavageete / sugama-sangeetha aesthetic asks for a
    specific prosody (slower, chest-resonant, slightly nasal on
    bhajan refrains) that a general-purpose model trained on
    broadcast-style Kannada doesn't reproduce well. The plan's
    "20–100 hours of curated Kannada speech" is specifically
    targeted at this aesthetic.
  - The custom model gives us a future-proof story for adding
    more Kannada personas: each new persona is a new speaker_id
    inside the same FastPitch checkpoint, so the catalogue grows
    without weights churn.
  - If the trained NeMo model ends up worse than IndicF5 on
    blind A/B (Sprint 16's reranker decides), we can flip the
    catalogue to `indicf5` with a single-line JSON edit — the
    routing layer doesn't care.

## Soft-fail contract

If NeMo fails to load (weights uncached on the host, or the
`nemo_toolkit` import fails) and `NEO_FM_REQUIRE_REAL_MODEL` is
unset, the router falls through to `FakeVocalModel`. DGX prod
sets `NEO_FM_REQUIRE_REAL_MODEL=1` so missing checkpoints fail
loud. This is the same dance Svara / Parler / IndicF5 use.

## Acceptance evidence

- 93 vocal-synth tests pass (10 new for NeMoTTSModel, 1 new for
  the catalogue contract, 4 new for routing, 6 new for curation,
  4 new for training).
- `voice_benchmark.py --dry-run` over 16 prompts × 4 backends
  emits 64 cells in `demos/v1.4/sprint-13-nemo-kannada/benchmark.md`
  + JSONL.
- `ruff check` clean across all Sprint 13 files.
- The two Kannada catalogue entries now resolve to `nemo` (see
  `tests/test_voice_catalog.py::test_sprint_13_nemo_personas_are_pinned`).
- The bench harness still produces 64 rows — confirming the
  Sprint 12 / Sprint 13 transition is invisible to downstream
  consumers.
