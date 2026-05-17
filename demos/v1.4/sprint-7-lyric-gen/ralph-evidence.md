# Ralph evidence — v1.4 Sprint 7

- **Status**: ✅ complete (sidecar + provider seam; SFT pending DGX run)
- **Commit**: (set after `git commit`)
- **Plan reference**: `neo-fm_v1.4_deep-dive_f76f15ee.plan.md` Sprint 7

## What shipped

- `services/lyric-gen/` — new FastAPI sidecar (HMAC + Prometheus +
  `/healthz` + `POST /v1/generate-lyric`).
  - `app/serve.py`: HTTP surface, request validation, in-flight tracking.
  - `app/model.py`: `FakeLyricGenModel` (deterministic, CI-friendly)
    and `_IndicBARTBackend` (lazy-loads transformers + peft on first
    `__call__`).
  - `app/metrics.py`: requests / latency / in-flight / wall-time counters
    + `lyric_gen_model_info`.
  - `pyproject.toml` defines `[project.optional-dependencies].training`
    so DGX can `uv sync --extra training` to pull torch/transformers/
    peft/datasets — the runtime sidecar doesn't pull these unless
    `LYRIC_GEN_BACKEND=indicbart`.
- `services/lyric-gen/scripts/prepare_dataset.py` — walks the Sprint 6
  PD corpus and emits `train.jsonl` + `eval.jsonl` + `stats.json` with a
  deterministic split (hash of `source_id + section_idx`). Smoke run
  against `data/public-lyrics/` produces 580 train + 60 eval examples
  across 7 languages.
- `services/lyric-gen/train.py` — IndicBART SFT entrypoint. Lazy-imports
  ML deps; `--dry-run` validates the harness without GPU. Supports
  `--lora-rank`, `--bf16` (default), `--push-to-hub`, resume from
  checkpoint.
- `services/lyric-gen/scripts/eval.py` — eval harness for three gates
  (G2P round-trip, syllable hit ratio, LLM-as-judge). Dry-run path
  reuses target as generation so we can wire the eval pipeline before
  the trainer produces real checkpoints.
- `packages/lyrics/src/provider.ts` — adds `IndicBARTLyricProvider` and
  `FallbackLyricProvider`. Both implement the existing `LyricsProvider`
  interface so callers (worker, build script, future RLHF reranker)
  don't have to branch on which one is wired.
  - `IndicBARTLyricProvider` builds a per-style section template via
    `mapToSections`, posts to the sidecar, maps the response back into
    typed `Section[]` keyed by `section_id`, fills `script` from the
    request language (`en→latin`, `hi/sa→devanagari`, `ta→tamil`, ...),
    and runs through `SongDocumentSchema.parse`.
  - `FallbackLyricProvider({ primary, fallback, enabled })` runs the
    public-library provider first and falls through to IndicBART when
    primary throws. `enabled: false` short-circuits to primary-only for
    the worker feature flag.
- `packages/lyrics/src/index.ts` re-exports the new providers and types
  so `@neo-fm/lyrics` consumers can wire them directly.

## Files touched

```
A docs/DECISIONS/0027-indicbart-lyric-gen.md
A services/lyric-gen/pyproject.toml
A services/lyric-gen/README.md
A services/lyric-gen/app/__init__.py
A services/lyric-gen/app/metrics.py
A services/lyric-gen/app/model.py
A services/lyric-gen/app/serve.py
A services/lyric-gen/scripts/__init__.py
A services/lyric-gen/scripts/prepare_dataset.py
A services/lyric-gen/scripts/eval.py
A services/lyric-gen/train.py
A services/lyric-gen/tests/__init__.py
A services/lyric-gen/tests/test_model.py
A services/lyric-gen/tests/test_serve.py
A services/lyric-gen/tests/test_prepare_dataset.py
A services/lyric-gen/tests/test_eval.py
A packages/lyrics/src/provider.indicbart.test.ts
M packages/lyrics/src/provider.ts
M packages/lyrics/src/index.ts
A demos/v1.4/sprint-7-lyric-gen/ralph-evidence.md
```

## Test results

```
# Python (lyric-gen sidecar)
$ cd services/lyric-gen && uv run pytest -x
22 passed in 0.49s

# TS (lyrics package)
$ pnpm --filter @neo-fm/lyrics test
Test Files  6 passed (6)
     Tests  38 passed (38)   # incl. 6 new IndicBART/Fallback tests

# Workspace typecheck + lint
$ pnpm -r typecheck     # 7 projects clean
$ pnpm lint             # next lint clean
```

## Smoke runs

```bash
# Dataset prep (no GPU needed)
$ cd services/lyric-gen
$ uv run python scripts/prepare_dataset.py \
    --corpus-root ../../data/public-lyrics \
    --out /tmp/lyric-gen-test
{
  "by_language": {
    "bn": {"eval": 1, "train": 24},
    "en": {"eval": 7, "train": 78},
    "hi": {"eval": 17, "train": 163},
    "kn": {"eval": 14, "train": 136},
    "sa": {"eval": 6, "train": 54},
    "ta": {"eval": 9, "train": 71},
    "te": {"eval": 6, "train": 54}
  },
  "train_count": 580,
  "eval_count": 60
}

# Trainer dry-run (no GPU needed)
$ uv run python train.py --dry-run \
    --dataset /tmp/lyric-gen-test \
    --output-dir /tmp/lyric-gen-run
{
  "base_model": "ai4bharat/IndicBART",
  "train_examples": 580,
  "eval_examples": 60,
  "epochs": 5,
  "batch_size": 8,
  "grad_accum": 4,
  "effective_batch": 32,
  "lr": 3e-05,
  "bf16": true,
  ...
}
```

## DGX-Spark compute note

The real SFT run is a DGX-only operation:

```bash
# On DGX Spark (GB10):
$ cd services/lyric-gen
$ uv sync --extra training       # pulls torch + transformers + peft
$ uv run python scripts/prepare_dataset.py \
    --corpus-root ../../data/public-lyrics \
    --out ./corpus
$ uv run python train.py \
    --dataset ./corpus \
    --output-dir ./runs/$(date +%Y%m%d-%H%M) \
    --epochs 5 --lr 3e-5 --bf16 --lora-rank 16 \
    --push-to-hub neo-fm/lyric-gen-indicbart
$ uv run python scripts/eval.py \
    --checkpoint ./runs/<id> \
    --eval-set ./corpus/eval.jsonl \
    --out ./runs/<id>/eval.json
```

Gates (per ADR 0027): G2P ≥ 0.90, syllable hit ≥ 0.60, judge ≥ 3.5/5.

## Notable decisions

- **Fake backend is the CI default.** `LYRIC_GEN_BACKEND` defaults to
  `fake` so unit tests + Docker smoke + worker dev never trigger
  IndicBART loading. Set `LYRIC_GEN_BACKEND=indicbart` (with HF token
  in env) on DGX to flip it.
- **Section IDs round-trip the sidecar.** The TS provider builds
  sections via `mapToSections` and uses the resulting `section.id`
  (`mukhda-1`, `pallavi-1`, `shloka_verse-1`, ...) as the
  `section_id` it asks for. The Python `_split_by_sections` parser uses
  the same IDs as anchor points. The IDs are derived from the template,
  not from data, so there's no model output the parser can't recover.
- **Prompt template pinned by test.**
  `tests/test_prepare_dataset.py::test_format_prompt_matches_model_format`
  imports both `prepare_dataset._format_prompt` and
  `app.model._format_prompt` and asserts byte-equality. Drift between
  train- and inference-time prompts is the single most painful failure
  mode for SFT fine-tunes and the test catches it.
- **`FallbackLyricProvider.enabled` defaults to `true`.** That matches
  the principle of least surprise (caller passes both providers ⇒
  caller wants fallback). The worker flips this off via
  `LYRIC_GEN_FALLBACK_ENABLED=false` until the SFT eval gates pass.
- **No worker hook yet.** Sprint 7's plan line was "wire as fallback
  provider"; the seam in `@neo-fm/lyrics` is the wiring. The actual
  selector flip happens in Sprint 8 when bhavageete LoRA bring-up
  starts generating its own eval set and needs the fallback path on.
