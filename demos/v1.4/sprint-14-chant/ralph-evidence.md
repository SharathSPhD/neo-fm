# Sprint 14 — Sanskrit / Vedic chant corpus + style adapter

Status: PASS
Date: 2026-05-17
Commit: pending

## What shipped

- New runtime module `services/vocal-synth/app/chant_style.py`
  exposes `ChantStyleSpec`, `load_chant_spec`,
  `should_use_chant_style`, and `apply_chant_prosody`. The
  envelope pass is mass-preserving in peak + length and
  deterministic.
- `app/routing.py` widened: `RouteDecision` gains
  `chant_style_applied`, `RoutingVocalModel` accepts
  `chant_spec=` and now applies the chant envelope per-section
  whenever any of the three activation triggers fires
  (voice_id ∈ chant personas, `style_family =
  sanskrit-shloka`, or section.type ∈ chant section types).
- New `scripts/curate_sanskrit_chant.py` curates a Sanskrit /
  Vedic chant corpus and emits a NeMo-format manifest augmented
  with `mantra_id` + `svara_marks`. `--dry-run` emits 4
  deterministic synthetic rows covering every svara label.
- New `scripts/train_chant_style_lora.py` trains a rank-16 LoRA
  on top of either IndicF5 or NeMo (`--base` switch). `--dry-run`
  validates the manifest, computes per-svara calibration
  medians, and writes `chant_style_lora.safetensors` +
  `adapter_config.json` + `svara_calibration.json` placeholders.
- New `SANSKRIT_SHLOKA` preset in
  `packages/style-presets/src/index.ts`. Pins chant personas
  per-section and uses the three Vedic section types
  (`shloka_verse`, `shloka_refrain`, `phalashruti`). Gallery
  grows from 8 to 9 cards; the new preset slots between
  `KABIR_DOHA` and `TAGORE_SET` so Indian-origin styles stay
  in the first half of the row.
- ADR 0034 captures the style-LoRA-not-fifth-backend decision,
  the three independent activation triggers, the always-on
  envelope rationale, and the soft-fail contract.

## Files touched

```
services/vocal-synth/app/chant_style.py                   added
services/vocal-synth/app/routing.py                       modified
services/vocal-synth/scripts/curate_sanskrit_chant.py     added
services/vocal-synth/scripts/train_chant_style_lora.py    added
services/vocal-synth/tests/test_chant_style.py            added
services/vocal-synth/tests/test_curate_sanskrit_chant.py  added
services/vocal-synth/tests/test_train_chant_style_lora.py added
services/vocal-synth/tests/test_routing.py                modified
packages/style-presets/src/index.ts                       modified
packages/style-presets/src/index.test.ts                  modified
docs/DECISIONS/0034-sanskrit-chant-style-adapter.md       added
demos/v1.4/sprint-14-chant/ralph-evidence.md              added
demos/v1.4/sprint-14-chant/chant_manifest.jsonl           generated (--dry-run)
demos/v1.4/sprint-14-chant/adapter/*                      generated (--dry-run)
```

## Tests added

- `tests/test_chant_style.py` (13 cases) — `should_use_chant_style`
  precedence (voice > style > section_type > none), spec loading
  with full / partial / missing artefacts (incl. `VOCAL_CHANT_LORA_DIR`
  env), envelope pass determinism, length preservation, peak
  bound, empty-audio safety, default window fallback when
  calibration is empty.
- `tests/test_curate_sanskrit_chant.py` (8 cases) — synthetic
  rows are deterministic and cover all three svaras; two
  speakers; unique mantra_ids; short-duration / duplicate-index
  / empty-text / unknown-svara rejection; `--dry-run` emits
  schema-correct JSONL; real-mode refuses in CI.
- `tests/test_train_chant_style_lora.py` (10 cases) — dry-run
  emits all three artefacts; `--base nemo` flips the config;
  calibration JSON has the three svara keys; manifest loader
  rejects missing/invalid/duplicate marks; `build_svara_calibration`
  returns medians; default LoRA config is rank 16; real-mode
  refuses in CI.
- `tests/test_routing.py` (3 new cases) — chant prosody fires
  on `sanskrit-shloka` style, fires on chant voice_id, does NOT
  fire on a vanilla Western verse.

## Promise gate

| check | result | evidence |
| --- | --- | --- |
| `pytest vocal-synth` | PASS | 128 passed, 1 skipped |
| `ruff check` on Sprint 14 files | PASS | clean across `app/chant_style.py`, `app/routing.py`, both new scripts, all new tests |
| `pnpm --filter @neo-fm/style-presets test` | PASS | 8/8 (8 -> 9 preset gallery, sanskrit-shloka included) |
| `pnpm -r test` | PASS | all packages green (195 web tests, 83 co-composer, 8 style-presets, etc.) |
| Sprint-14 dry-run pipeline (curate + train) | PASS | 4-row manifest + 3-file adapter on disk |

```
$ cd services/vocal-synth && uv run pytest -x -q
.........................................................s..............  [ 55%]
.........................................................                [100%]
128 passed, 1 skipped in 0.36s

$ cd services/vocal-synth && uv run python scripts/curate_sanskrit_chant.py \
    --out ../../demos/v1.4/sprint-14-chant/chant_manifest.jsonl --dry-run
[dry-run] wrote 4 synthetic chant rows to ../../demos/v1.4/sprint-14-chant/chant_manifest.jsonl;
sources cited: 3 (~30.0h target on DGX).

$ cd services/vocal-synth && uv run python scripts/train_chant_style_lora.py \
    --manifest ../../demos/v1.4/sprint-14-chant/chant_manifest.jsonl \
    --out-dir ../../demos/v1.4/sprint-14-chant/adapter --dry-run
[dry-run] validated 4 chant rows (0.0064 h), base=indicf5, wrote
placeholders to ../../demos/v1.4/sprint-14-chant/adapter; svara
calibration medians: {'svarita': 0.55, 'udatta': 0.525, 'anudatta': 0.35}.
```

## Notable decisions

- See ADR 0034 — Why style adapter, not fifth backend; why three
  activation triggers; always-on envelope pass rationale;
  soft-fail contract.
- DGX-only: corpus curation + LoRA training run on DGX-Spark per
  ADR 0023. HuggingFace is used only to push the final
  `neo-fm/chant-style-v1` artefacts to a private repo.
- Reversibility: unstaging `VOCAL_CHANT_LORA_DIR` degrades chant
  to envelope-only without a code change. Deactivating chant
  entirely is a 1-line preset / catalogue edit.
- Schema: `song-doc` already shipped chant section types and
  the `sanskrit-shloka` style family in Sprint 2; this sprint
  activates them without further migrations.
