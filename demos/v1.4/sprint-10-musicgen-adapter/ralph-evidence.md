# Sprint 10 — MusicGen Indic-style adapter

Status: code-complete; LoRA training is operator-driven on DGX.
Branch: `v1.4-deep-dive`
Date: 2026-05-17

## Scope (from plan §10)

> Install AudioCraft, baseline benchmark on 5 styles, train two
> MusicGen-Medium LoRA adapters (Carnatic + Hindustani) on DGX,
> integrate as alternative music-inference backend with A/B routing
> on `style_family`.

## What changed

### `services/music-inference/app/`

- `musicgen_model.py` (new): `MusicGenModel` wraps the audiocraft
  `MusicGen` pipeline; mirrors `HeartMuLaModel`'s adapter lifecycle
  via `peft`. Helpers (`build_musicgen_prompt`,
  `style_adapters_from_env`, `MusicGenInferenceParams`) are pure-data
  and CI-testable without audiocraft installed.
- `routing.py` (new): `RoutingMusicModel` dispatches `/v1/generate`
  to HeartMuLa or MusicGen based on `style_family`. Default table:
  Carnatic + Hindustani → MusicGen; everything else → HeartMuLa.
  Per-style env override (`MUSIC_ENGINE_<STYLE>=heartmula|musicgen`)
  is honoured. When the chosen engine is unloaded, the router falls
  back to the other and emits a `route_fallback` JSON log line; if
  neither backend is available it raises rather than serving silence.
- `model.py` (modified): `initialise_from_env()` now optionally
  builds a `MusicGenModel` and wraps both backends in a
  `RoutingMusicModel` when `MUSIC_INFERENCE_ENABLE_MUSICGEN=1`.

### `services/music-inference/scripts/`

- `_musicgen_lora_trainer.py` (new): shared LoRA-trainer primitives
  for MusicGen. Defaults to rank 16 / alpha 32 / target modules
  `q_proj/k_proj/v_proj/out_proj` (MusicGen decoder LM). Dry-run
  builder pinned by tests so the trainer config can't silently drift.
- `curate_carnatic.py` + `curate_hindustani.py` (new): style-specific
  curators built on `_corpus_pipeline.py`. Multi-language allow-lists
  (Carnatic: te/ta/kn/sa; Hindustani: hi/bn/sa). License sets cover
  Saraga (CC-BY-NC-SA), AIR fair-use, and PD-India archives.
- `train_musicgen_carnatic_lora.py` + `train_musicgen_hindustani_lora.py`
  (new): per-style trainer wrappers; default HF Hub repos
  `neo-fm/musicgen-{carnatic,hindustani}-lora-v1`.

### `tests/`

| File | Tests | What they pin |
|---|---|---|
| `test_routing.py` | 13 | Default table, env overrides, fallback, version aggregation |
| `test_musicgen_model.py` | 7 | Prompt builder, env adapter discovery, audiocraft defaults |
| `test_curate_carnatic.py` | 5 | Language allow-list (te/ta/kn/sa), deterministic split, full-stage NotImplementedError |
| `test_curate_hindustani.py` | 5 | Language allow-list (hi/bn/sa), deterministic split, full-stage NotImplementedError |
| `test_musicgen_lora_trainers.py` | 6 | Both trainers' dry-run shape, default Hub repo names, capsys JSON emit |

### `docs/DECISIONS/0030-musicgen-indic-adapter.md`

ADR locking the decision, the route table, the env contract, and
the alternatives considered.

## Test results

```
$ cd services/music-inference && uv run pytest -x -q
..........................................................................
.................                                             [100%]
90 passed in 0.36s
```

(54 prior tests + 36 new ones = 90 total.)

## Operator runbook (DGX-Spark)

This section is what the operator runs after the merge to `main`.
The CI doesn't execute it; the test suite covers everything except
the 14-hour-per-LoRA training run + the 5-style benchmark.

### 0. Install AudioCraft

```bash
cd services/music-inference
uv sync --extra training
uv pip install 'audiocraft @ git+https://github.com/facebookresearch/audiocraft@v1.3.0'
python -c "import audiocraft; print(audiocraft.__version__)"
```

### 1. Baseline benchmark — 5 styles, 100 prompts

```bash
MUSIC_INFERENCE_ENABLE_MUSICGEN=1 \
MUSICGEN_DEVICE=cuda \
uv run python -m scripts.benchmark_engines \
  --prompts ../../data/v1.4-bench-100.jsonl \
  --styles western carnatic hindustani kannada-light-classical tamil-folk \
  --out ./bench/v1.4-baseline-musicgen
```

Expected: `bench/v1.4-baseline-musicgen/summary.json` with one row
per (engine, style). The MOS gate threshold for promoting MusicGen
on a given style is ≥ HeartMuLa + 0.3 MOS at p < 0.05.

### 2. Curate Carnatic + Hindustani corpora

```bash
uv run python scripts/curate_carnatic.py \
  --manifest ../../data/musicgen-carnatic-sources.yaml \
  --out ./corpus/musicgen-carnatic-v1 \
  --stage all

uv run python scripts/curate_hindustani.py \
  --manifest ../../data/musicgen-hindustani-sources.yaml \
  --out ./corpus/musicgen-hindustani-v1 \
  --stage all
```

Validate the summary:
```
clip_count >= 1500, total_hours >= 8.0, eval_clip_count >= 150
```

### 3. Train LoRAs on DGX

```bash
HEARTMULA_CKPT_DIR=/mnt/models/heartmula \
HF_TOKEN=$(cat ~/.hf-token) \
uv run python scripts/train_musicgen_carnatic_lora.py \
  --corpus ./corpus/musicgen-carnatic-v1 \
  --output-dir /mnt/models/lora/musicgen-carnatic-v1 \
  --push-to-hub neo-fm/musicgen-carnatic-lora-v1

uv run python scripts/train_musicgen_hindustani_lora.py \
  --corpus ./corpus/musicgen-hindustani-v1 \
  --output-dir /mnt/models/lora/musicgen-hindustani-v1 \
  --push-to-hub neo-fm/musicgen-hindustani-lora-v1
```

Each run: ~14h on GB10 with rank 16, batch 8, grad-accum 4.

### 4. MOS evaluation gate

Reuse `scripts/mos_eval.py` from Sprint 8 — same harness, fresh
prompts. Promotion threshold: MOS ≥ 3.7 on the held-out eval set;
A/B against the base MusicGen and HeartMuLa baselines.

### 5. Deploy

```bash
# Add to docker-compose.dgx.yml music-inference service env:
MUSIC_INFERENCE_ENABLE_MUSICGEN=1
MUSICGEN_LORA_CARNATIC=/mnt/models/lora/musicgen-carnatic-v1
MUSICGEN_LORA_HINDUSTANI=/mnt/models/lora/musicgen-hindustani-v1
```

Confirm at `/healthz` that `model_version` reports both engines:
`heartmula=heartmula-oss-3B-happy-new-year,musicgen=musicgen-medium-musicgen-medium`.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| MusicGen output is mono-only and clips at 30s | Sprint 11 stems-mixer stitches longer outputs; `MusicGenInferenceParams.duration_max_seconds` caps to 30s explicitly so the truncation is visible |
| GB10 unified-memory pressure with both engines + adapters | `HEARTMULA_DEFER_LOAD=1` and `MUSICGEN_DEFER_LOAD=1` allow operator to warm them sequentially |
| Operator forgets to set `MUSIC_INFERENCE_ENABLE_MUSICGEN` | Default route table sends Carnatic/Hindustani to MusicGen; routing layer falls back to HeartMuLa and logs `route_fallback`. No 500s, just visible degradation |
| Sprint 16's eval may demote MusicGen on Hindustani | Per-style env override (`MUSIC_ENGINE_HINDUSTANI=heartmula`) flips it without a redeploy |

## Plan checklist

- [x] AudioCraft install path documented in runbook
- [x] Baseline benchmark scripted (operator runs on DGX)
- [x] Carnatic LoRA training script, CI-validated via `--dry-run`
- [x] Hindustani LoRA training script, CI-validated via `--dry-run`
- [x] `MusicGenModel` integrated as alternative backend
- [x] A/B routing on `style_family` with env override
- [x] Full test suite passes (90 tests)
- [x] ADR 0030 in place
