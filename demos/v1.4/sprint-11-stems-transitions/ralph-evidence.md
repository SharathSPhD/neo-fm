# Sprint 11 — Stable Audio Open stems + transitions

Status: PASS
Date: 2026-05-17
Commit: pending

## What shipped

- New sidecar `services/stems-synth/` (FastAPI), HMAC-authenticated, returning 16-bit / 44.1 kHz WAV for one of 9 transition presets (`harmonium_interlude`, `tabla_tihai`, `tanpura_drone`, `mridangam_korvai`, `parai_break`, `nadaswaram_flourish`, `shloka_bell_open`, `esraj_swell`).
- `services/stems-synth/scripts/curate_stems.py` + `train_stems_lora.py` reuse `_corpus_pipeline.py` and a new `_stems_lora_trainer` shape; both have a `--dry-run` path used by CI.
- `dgx-worker` integrates stems end-to-end:
  - `app/stem_planner.py` — pure-data planner that emits ordered `PlannedStem`s from `(sections, style_family)`.
  - `app/stems_client.py` — HMAC-signed httpx client to call the new sidecar.
  - `app/mixer.py` — `StemInsert` dataclass + `_apply_stem_inserts` performs equal-power crossfades into the base mix.
  - `app/worker.py` — `_fetch_stem_inserts` runs the plan, fans out fetches, logs `stem_plan` + per-failure `stem_fetch_failed`, and passes results to `mix_to_stereo_48k(..., stem_inserts=...)`.
  - `app/config.py` — four new env vars (`STEMS_SYNTH_URL`, `STEMS_SYNTH_HMAC_SECRET`, `STEMS_SYNTH_TIMEOUT_SECONDS`, `STEMS_MAX_INSERTS_PER_SONG`).
  - `app/metrics.py` — `neofm_worker_stem_failures_total{preset}`.
- ADR 0031 captures the architecture and the soft-fail / deterministic-planning contract.

## Files touched

```
services/stems-synth/pyproject.toml                          added/modified
services/stems-synth/README.md                               added
services/stems-synth/app/__init__.py                         added
services/stems-synth/app/metrics.py                          added
services/stems-synth/app/model.py                            added
services/stems-synth/app/serve.py                            added
services/stems-synth/scripts/__init__.py                     added
services/stems-synth/scripts/curate_stems.py                 added
services/stems-synth/scripts/train_stems_lora.py             added
services/stems-synth/tests/test_model.py                     added
services/stems-synth/tests/test_serve.py                     added
services/stems-synth/tests/test_curate_stems.py              added
services/stems-synth/tests/test_train_stems_lora.py          added
services/dgx-worker/app/config.py                            modified
services/dgx-worker/app/mixer.py                             modified
services/dgx-worker/app/metrics.py                           modified
services/dgx-worker/app/stem_planner.py                      added
services/dgx-worker/app/stems_client.py                      added
services/dgx-worker/app/worker.py                            modified
services/dgx-worker/tests/test_mixer.py                      modified
services/dgx-worker/tests/test_stem_planner.py               added
docs/DECISIONS/0031-stable-audio-stems-transitions.md        added
demos/v1.4/sprint-11-stems-transitions/ralph-evidence.md     added
```

## Tests added

- `services/dgx-worker/tests/test_stem_planner.py` (11 cases) — covers bhavageete = 3 inserts at `[20, 45, 85]` s, preset rotation, per-style first-choice, unknown/western style → `[]`, single-section guard, `max_inserts` cap, parametrised "every Indic style has ≥1 stem".
- `services/dgx-worker/tests/test_mixer.py` (extended with 6 cases) — `StemInsert` crossfading, ducking, multi-stem layering.
- `services/stems-synth/tests/test_model.py`, `test_serve.py`, `test_curate_stems.py`, `test_train_stems_lora.py` (31 cases across all four).

## Promise gate

| check | result | evidence |
| --- | --- | --- |
| `pytest dgx-worker` | PASS | 74/74 (1 skipped — pre-existing) |
| `pytest stems-synth` | PASS | 31/31 |
| `ruff check` on Sprint 11 files | PASS | "All checks passed!" on `app/stem_planner.py`, `app/stems_client.py`, `tests/test_stem_planner.py` |
| Bhavageete contract: 3 inserts logged | PASS | `test_bhavageete_planner_produces_three_inserts` asserts `len(plan) == 3` and times `[20.0, 45.0, 85.0]` |
| Stems-synth soft-fail | PASS | `_fetch_stem_inserts` drops failed inserts, logs `stem_fetch_failed`, increments `neofm_worker_stem_failures_total{preset}` |

```
$ cd services/dgx-worker && uv run pytest -x -q
................s....................................................... [100%]

$ cd services/stems-synth && uv run pytest -x -q
...............................                                          [100%]
```

## Notable decisions

- See ADR 0031 — Stable Audio Open chosen for short-clip generation, separate sidecar for independent scaling, deterministic boundary-only planner so Sprint 16 reranker has a stable candidate-gen step.
- `stable-audio-tools` is **manually** installed on the DGX (`uv pip install 'stable-audio-tools @ git+...'`) because its old `wandb` pin breaks `uv` resolution. CI uses `FakeStemModel`.
- Soft-fail per-insert: a 5xx for one stem does not kill the job; the mix is releasable, the operator dashboard surfaces the drop via the new counter.
