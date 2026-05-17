# Ralph evidence — v1.4 Sprint 9

- **Status**: ✅ complete (curation + trainer entrypoints + tests + ADR; SFT run is a DGX operator follow-up)
- **Commit**: (set after `git commit`)
- **Plan reference**: `neo-fm_v1.4_deep-dive_f76f15ee.plan.md` Sprint 9

## What shipped

Sprint 9 is the Tamil-folk twin of Sprint 8. Because Sprint 8 left
behind two duplicated scripts (curate + train), Sprint 9's first move
is to lift the shared logic into helper modules; the new Tamil-folk
entrypoints are ~50 LOC each on top of those helpers.

### Shared pipeline modules

- `services/music-inference/scripts/_corpus_pipeline.py` — extracted
  the per-style corpus pipeline. Pinned API:
  `SourceClip`, `Caption`, `load_manifest`, `validate_manifest(*,
  expected_language, allowed_licenses, max_clip_seconds=60.0)`,
  `emit_manifest_summary(clips, out_dir)`. 90/10 split-by-hash lives
  here so identical manifests yield identical eval sets across
  styles.
- `services/music-inference/scripts/_lora_trainer.py` — extracted
  the per-style LoRA trainer. Pinned API: `build_dry_run_summary`,
  `add_common_args`, `run_or_dry`. Sprint 10 + 14 will reuse this.

### Tamil-folk entrypoints

- `services/music-inference/scripts/curate_tamil_folk.py` —
  Tamil-folk-specific knobs only: `EXPECTED_LANGUAGE = "ta"`,
  `ALLOWED_LICENSES` adds `cc-by-sa` for BL Sounds.
- `services/music-inference/scripts/train_tamil_folk_lora.py` —
  Tamil-folk-specific knobs only: `STYLE_FAMILY = "tamil-folk"`,
  `DEFAULT_HUB_REPO = "neo-fm/heartmula-tamil-folk-lora-v1"`.

### Tests

- `services/music-inference/tests/test_curate_tamil_folk.py` — 4
  cases: load+validate+summarise, reject non-Tamil language, accept
  cc-by-sa (which bhavageete rejects), pipeline-shared-with-bhavageete
  smoke (both curators called in the same process, no global state
  bleeding through `_corpus_pipeline`).
- `services/music-inference/tests/test_train_tamil_folk_lora.py` — 4
  cases: dry-run rc 0, style label = `tamil-folk` in summary, missing
  corpus fails with the right error, `DEFAULT_HUB_REPO` documented.

Sprint 8's tests pass unchanged after the refactor.

## Files touched

```
A docs/DECISIONS/0029-tamil-folk-lora.md
A services/music-inference/scripts/_corpus_pipeline.py
A services/music-inference/scripts/_lora_trainer.py
M services/music-inference/scripts/curate_bhavageete.py
M services/music-inference/scripts/train_bhavageete_lora.py
A services/music-inference/scripts/curate_tamil_folk.py
A services/music-inference/scripts/train_tamil_folk_lora.py
A services/music-inference/tests/test_curate_tamil_folk.py
A services/music-inference/tests/test_train_tamil_folk_lora.py
A demos/v1.4/sprint-9-tamil-folk-lora/ralph-evidence.md
```

## Test results

```
# Python (music-inference)
$ cd services/music-inference && uv run pytest
54 passed in 0.35s     # 8 new tests across the 2 new test files

# Workspace
$ pnpm -r typecheck    # 7 projects clean
$ pnpm lint            # next lint clean
```

## DGX-Spark compute note

The actual SFT run mirrors Sprint 8 with two label swaps:

```bash
$ uv sync --extra training
$ uv run python scripts/curate_tamil_folk.py \
    --manifest ../../data/tamil-folk-sources.yaml \
    --out ./corpus/tamil-folk-v1 \
    --stage all
$ uv run python scripts/train_tamil_folk_lora.py \
    --corpus ./corpus/tamil-folk-v1 \
    --output-dir ./runs/$(date +%Y%m%d-%H%M)-tamil-folk \
    --rank 32 --alpha 64 --lr 1e-4 --epochs 5 --bf16 \
    --push-to-hub neo-fm/heartmula-tamil-folk-lora-v1
$ uv run python scripts/mos_eval.py build-survey \
    --prompts ./tamil-folk-eval-prompts.jsonl \
    --out ./mos-tamil-folk-v1
$ # operators generate WAVs, Tamil-fluent reviewers submit ratings
$ uv run python scripts/mos_eval.py aggregate \
    --survey ./mos-tamil-folk-v1/survey.json \
    --submissions ./mos-tamil-folk-v1/ratings.jsonl \
    --out ./mos-tamil-folk-v1/result.json

# Deploy after MOS uplift ≥ 0.5:
$ # HEARTMULA_LORA_TAMIL_FOLK=/mnt/models/lora/tamil-folk-v1
```

The MOS eval pipeline is style-agnostic — Sprint 8's `mos_eval.py`
takes any prompts.jsonl. Tamil-fluent reviewer pool is recruited via
the same Slack survey channel Sprint 8 used for Kannada reviewers.

## Notable decisions

- **DRY refactor first, Tamil-folk second.** Sprint 8 left duplicated
  scaffold (curate + train scripts). Sprint 9 extracts the shared
  logic into `_corpus_pipeline.py` + `_lora_trainer.py` and rebases
  bhavageete on top, then adds Tamil-folk entrypoints. Cost: ~150
  LOC moved into helpers, ~100 LOC added for Tamil-folk; payoff:
  Sprint 10 + 14 each save a similar duplication tax.
- **`cc-by-sa` permitted for Tamil-folk only.** Bhavageete's allowed
  set was `pd-india / pd-us / cc-by / cc-by-nc-sa / fair-use-§52`.
  Tamil-folk needs CC-BY-SA for BL Sounds. Rather than universalize
  the bhavageete set (which would let a stray CC-BY-SA Saraga import
  slip into Kannada training), each curator declares its own set
  explicitly and the validator refuses anything outside it.
- **No new SongDocument schema fields.** Sprint 8 added the
  `style_adapters` registry; Sprint 9 only adds a row to it (via env
  var) for `tamil-folk`. Production env-vars stay unset until the MOS
  uplift verifies.
- **Pipeline isolation test.** `test_pipeline_shared_with_bhavageete`
  calls both curators in one process, with different manifests, and
  asserts both succeed. Prevents a future refactor introducing
  module-level mutable state in `_corpus_pipeline` (e.g. caching the
  expected_language as a global).
