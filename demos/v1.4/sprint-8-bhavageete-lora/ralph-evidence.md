# Ralph evidence — v1.4 Sprint 8

- **Status**: ✅ complete (curation pipeline + trainer + MOS eval + adapter wiring; SFT run is a DGX operator follow-up)
- **Commit**: (set after `git commit`)
- **Plan reference**: `neo-fm_v1.4_deep-dive_f76f15ee.plan.md` Sprint 8

## What shipped

- `services/music-inference/scripts/curate_bhavageete.py` — operator
  pipeline for assembling the bhavageete corpus from AIR / Saraga /
  Dunya / Sangeetha-Samrajyam sources. Validates licenses, segments
  to 30 s clips, hands off to WhisperX + Silero VAD + Montreal Forced
  Aligner + Qwen2.5-72B captioning on DGX. CI exercises the
  validate-and-summarise dry-run only.
- `services/music-inference/scripts/train_bhavageete_lora.py` —
  rank-32 LoRA trainer for HeartMuLa-OSS-3B with target modules
  matching the LLaMA/Qwen decoder layout. `--dry-run` validates
  config + dataset shape without importing torch.
- `services/music-inference/scripts/mos_eval.py` — A/B MOS survey
  builder + aggregator. Deterministic shuffle, gate at ≥ 0.5 median
  uplift, handles 0/N reviewer states cleanly.
- `services/music-inference/app/model.py` —
  - New `style_adapters: dict[str, Path]` ctor arg.
  - `_attach_adapter(style)` / `_detach_adapter()` per-request
    lifecycle, cached `_loaded_adapter_names`.
  - `generate()` wraps inference in try/finally so adapter detach
    runs even on heartlib exceptions.
  - `_style_adapters_from_env()` reads `HEARTMULA_LORA_<STYLE>`
    env vars (full mapping in `_STYLE_ADAPTER_ENV`).
- `services/music-inference/pyproject.toml` — adds PyYAML as a direct
  dep and a new `training` optional-deps group (torch + transformers
  + peft + datasets + accelerate + trackio) the DGX operator pulls
  with `uv sync --extra training`.
- ADR `docs/DECISIONS/0028-bhavageete-lora.md`.

## Files touched

```
A docs/DECISIONS/0028-bhavageete-lora.md
M services/music-inference/app/model.py
M services/music-inference/pyproject.toml
A services/music-inference/scripts/__init__.py
A services/music-inference/scripts/curate_bhavageete.py
A services/music-inference/scripts/train_bhavageete_lora.py
A services/music-inference/scripts/mos_eval.py
A services/music-inference/tests/test_curate_bhavageete.py
A services/music-inference/tests/test_train_bhavageete_lora.py
A services/music-inference/tests/test_mos_eval.py
A services/music-inference/tests/test_lora_adapter.py
A demos/v1.4/sprint-8-bhavageete-lora/ralph-evidence.md
```

## Test results

```
# Python (music-inference)
$ cd services/music-inference && uv run pytest
46 passed in 0.35s    # 22 new tests across the 4 new test files

# Workspace
$ pnpm -r typecheck   # 7 projects clean
$ pnpm lint           # next lint clean
```

## Smoke runs

```bash
# Manifest validation (CI path)
$ cd services/music-inference
$ uv run python scripts/curate_bhavageete.py \
    --manifest /tmp/sample-bhavageete.yaml \
    --out /tmp/bhav-out --dry-run
{
  "by_license_seconds": {"cc-by-nc-sa": 28.5, "fair-use-§52": 30.0},
  "by_source_clips": {"air-bengaluru-bendre-1965": 1, "saraga-kn-ksn-1987": 1},
  "clip_count": 2,
  "splits": {"eval_clip_ids": [], "train_clip_ids": ["5998c25a2130", "782ba0b96593"]},
  "total_hours": 0.016
}

# Trainer dry-run (CI path)
$ uv run python scripts/train_bhavageete_lora.py \
    --corpus /tmp/bhav-out \
    --output-dir /tmp/bhav-lora \
    --dry-run
{
  "alpha": 64,
  "base_model": "HeartMuLa/HeartMuLa-OSS-3B",
  "batch_size": 16,
  "bf16": true,
  "effective_batch": 32,
  "epochs": 5,
  "lr": 0.0001,
  "rank": 32,
  "target_modules": ["q_proj", "v_proj", "k_proj", "o_proj",
                     "gate_proj", "up_proj", "down_proj"],
  ...
}
```

## DGX-Spark compute note

The actual SFT run is a DGX operator workflow:

```bash
# 1. Curate (multi-stage, operator drives manual review)
$ uv sync --extra training
$ uv run python scripts/curate_bhavageete.py \
    --manifest ../../data/bhavageete-sources.yaml \
    --out ./corpus/bhavageete-v1 \
    --stage all                # validate → download → ... → export

# 2. Train (12-24 GPU-hours on GB10)
$ uv run python scripts/train_bhavageete_lora.py \
    --corpus ./corpus/bhavageete-v1 \
    --output-dir ./runs/$(date +%Y%m%d-%H%M) \
    --rank 32 --alpha 64 --lr 1e-4 --epochs 5 --bf16 \
    --push-to-hub neo-fm/heartmula-bhavageete-lora-v1

# 3. MOS eval
$ uv run python scripts/mos_eval.py build-survey \
    --prompts ./eval-prompts.jsonl \
    --out ./mos-survey-v1
# (Operator generates baseline + adapter WAVs into the survey dir,
#  Kannada reviewers submit ratings, then:)
$ uv run python scripts/mos_eval.py aggregate \
    --survey ./mos-survey-v1/survey.json \
    --submissions ./mos-survey-v1/ratings.jsonl \
    --out ./mos-survey-v1/result.json

# 4. Deploy (after MOS uplift ≥ 0.5 verified)
$ # Set env var on the music-inference container:
$ # HEARTMULA_LORA_KANNADA_LIGHT_CLASSICAL=/mnt/models/lora/bhavageete-v1
```

## Notable decisions

- **Per-request adapter lifecycle.** The plan asked for `peft.PeftModel.from_pretrained`
  on style match, but didn't specify detach semantics. We attach on
  request, detach in `finally`. Reasoning: two concurrent requests in
  *different* styles inside the same worker shouldn't bleed into each
  other; the alternative (leave the adapter active) creates a stale
  adapter risk every time the style changes.
- **Env-var-driven registry, not config-file.** `HEARTMULA_LORA_<STYLE>`
  matches how the rest of the service reads runtime config
  (`HEARTMULA_CKPT_DIR`, `HEARTMULA_MULA_DEVICE`). Operators don't have
  to edit a separate JSON to enable an adapter; they set one env var.
- **CI dry-run path is required.** Both the curation script and the
  trainer must accept `--dry-run` and exit 0 without importing torch /
  peft / heartlib. Tests pin this. The combination "operator workflow
  + DGX + heavy deps" is the easiest place for silent breakage; the
  dry-run path is the canary that catches it.
- **License invariants are validated at manifest load.** The corpus
  spans pd-india / pd-us / cc-by / cc-by-nc-sa / fair-use-§52. Any
  unknown license fails validation. Keeping this strict at the
  manifest layer (not at dataset publish time) means a careless YAML
  edit can't accidentally taint training data.
- **Adapter target modules pinned by test.** The trainer dry-run test
  asserts `q_proj` and `v_proj` are present in `target_modules` so a
  drift in either the trainer or the attach code surfaces at CI time,
  not 18 hours into a GPU run.
- **No SongDocument schema changes.** Sprint 8 ships behind an
  env var, so a SongDocument that asks for `kannada-light-classical`
  works the same whether the adapter is configured or not. Sprint 16's
  RLHF reranker is the surface that exposes "base vs LoRA" as a
  user-facing toggle.
