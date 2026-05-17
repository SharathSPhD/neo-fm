# Sprint 13 — Custom NeMo Kannada TTS

Status: PASS
Date: 2026-05-17
Commit: pending

## What shipped

- New backend `services/vocal-synth/app/nemo.py` wraps NeMo's
  FastPitch + HiFi-GAN with deferred `torch` / `nemo_toolkit`
  imports — unit tests inject a stubbed inner model and exercise
  the WAV-header / pad-trim / peak-normalise path without
  installing the toolkit.
- `app/routing.py` widened: `BackendKey` now includes `"nemo"`,
  `_pick_backend` honours catalogue entries with
  `backend="nemo"`, and `RoutingVocalModel` lazily loads NeMo
  with the same soft-fallback dance as Parler / IndicF5.
- `app/voice_catalog.json` updated: `indic_kn_male_warm` and
  `indic_kn_female_bhajan` flip from `parler` to `nemo`. Header
  comment now reflects the S12+S13 sweep (8 IndicF5, 2 NeMo,
  6 Parler).
- New `scripts/curate_kannada_tts.py` curates a NeMo manifest
  JSONL from a raw-audio root; `--dry-run` emits a deterministic
  synthetic manifest so CI exercises the schema.
- New `scripts/train_kannada_nemo.py` orchestrates the FastPitch
  + HiFi-GAN two-stage recipe and writes a speaker-map JSON;
  `--dry-run` emits placeholder `.nemo` artifacts so CI exercises
  the file-layout contract.
- `scripts/voice_benchmark.py` now loads `NeMoTTSModel` as the
  fourth backend (CI keeps it stubbed, DGX real-mode swaps in the
  trained weights).
- ADR 0033 captures the FastPitch+HiFi-GAN choice, the
  speaker-map contract, and why we kept the routing layer
  generic.

## Files touched

```
services/vocal-synth/app/nemo.py                     added
services/vocal-synth/app/routing.py                  modified
services/vocal-synth/app/voice_catalog.json          modified
services/vocal-synth/scripts/curate_kannada_tts.py   added
services/vocal-synth/scripts/train_kannada_nemo.py   added
services/vocal-synth/scripts/voice_benchmark.py      modified
services/vocal-synth/tests/test_nemo.py              added
services/vocal-synth/tests/test_curate_kannada_tts.py added
services/vocal-synth/tests/test_train_kannada_nemo.py added
services/vocal-synth/tests/test_routing.py           modified
services/vocal-synth/tests/test_voice_catalog.py     modified
services/vocal-synth/tests/test_voice_benchmark.py   modified
docs/DECISIONS/0033-nemo-kannada-tts.md              added
demos/v1.4/sprint-13-nemo-kannada/ralph-evidence.md  added
demos/v1.4/sprint-13-nemo-kannada/benchmark.md       generated (--dry-run)
demos/v1.4/sprint-13-nemo-kannada/benchmark.jsonl    generated (--dry-run)
```

## Tests added

- `tests/test_nemo.py` (10 cases) — stubbed FastPitch + HiFi-GAN
  inner modules; speaker-ID resolution (catalogue lookup +
  unknown-voice fallback to 0); `synthesise()` end-to-end pad /
  trim / peak normalise; instrumental sections short-circuit;
  load() idempotency.
- `tests/test_routing.py` (4 new cases) — `_pick_backend` routes
  `voice_id=indic_kn_male_warm` to `"nemo"` and
  `indic_kn_female_bhajan` to `"nemo"`; full `RoutingVocalModel`
  dispatch lands at the NeMo spy; `model_loaded` and
  `model_version` propagate.
- `tests/test_voice_catalog.py` (1 new case) — pins which 2
  personas live on NeMo in S13.
- `tests/test_curate_kannada_tts.py` (6 cases) — dry-run emits
  schema-correct manifest, speaker IDs in `[0, 1]`, deterministic
  ordering, output dir creation.
- `tests/test_train_kannada_nemo.py` (4 cases) — dry-run writes
  fastpitch + hifigan placeholder `.nemo`s; speaker-map JSON has
  the two-voice contract; manifest round-trips.
- `tests/test_voice_benchmark.py` updated — `nemo` is now a real
  fake-loaded column (4-backend bench).

## Promise gate

| check | result | evidence |
| --- | --- | --- |
| `pytest vocal-synth` | PASS | 93 passed, 1 skipped |
| `ruff check` on Sprint 13 files | PASS | clean across `app/nemo.py`, `app/routing.py`, both new scripts, all new tests |
| `pnpm --filter @neo-fm/co-composer test` | PASS | 83/83 (catalogue TS mirror still omits `backend`) |
| Voice benchmark (--dry-run, 16 prompts × 4 backends) | PASS | 64 cells in `benchmark.md`, JSONL has 64 rows |

```
$ cd services/vocal-synth && uv run pytest -x -q
....................................................................     [ 76%]
......................                                                   [100%]
93 passed, 1 skipped in 0.31s

$ cd services/vocal-synth && uv run python scripts/voice_benchmark.py \
    --prompts data/voice-benchmark/prompts.jsonl \
    --out ../../demos/v1.4/sprint-13-nemo-kannada/benchmark.md \
    --out-jsonl ../../demos/v1.4/sprint-13-nemo-kannada/benchmark.jsonl \
    --dry-run
wrote ../../demos/v1.4/sprint-13-nemo-kannada/benchmark.md (64 cells across 16 prompts)
```

## Notable decisions

- See ADR 0033 — Why FastPitch + HiFi-GAN over end-to-end VITS,
  why a separate `NeMoTTSModel` class, the speaker-map contract,
  and the soft-fail behaviour.
- DGX-only: corpus curation and training run on DGX-Spark per
  ADR 0023. HuggingFace is used only to push the final `.nemo`
  artifacts to a private repo.
- Reversibility: the routing layer doesn't care which backend
  serves Kannada; if Sprint 16's reranker prefers IndicF5 over
  NeMo, the catalogue flips back with a one-line JSON edit.
