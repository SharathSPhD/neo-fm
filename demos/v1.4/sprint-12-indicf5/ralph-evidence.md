# Sprint 12 — IndicF5 vocal backend

Status: PASS
Date: 2026-05-17
Commit: pending

## What shipped

- New backend `services/vocal-synth/app/indicf5.py` wraps
  `ai4bharat/IndicF5`. Defers torch import + `inference_mode`
  context to `load()`; unit tests inject a stubbed inner model and
  hit the full WAV-header / resample / pad-trim / peak-normalise
  path without torch.
- `app/routing.py` widened: `BackendKey` now includes `"indicf5"`,
  `_pick_backend` honours the catalogue's `backend="indicf5"` flag,
  and `RoutingVocalModel` lazily loads the new backend with the
  same soft-fallback dance as Parler/Svara.
- `app/voice_catalog.json` updated: 8 indic_* personas (hi×2,
  ta×2, te×2, bn×2) flip from `parler` to `indicf5`. The 2
  `indic_kn_*` personas stay on Parler until Sprint 13 swaps them
  to NeMo Kannada.
- New `scripts/voice_benchmark.py` runs N prompts × 4 backends
  (svara, parler, indicf5, nemo-placeholder) and emits a markdown
  table + JSONL. CI exercises it in `--dry-run` (all backends are
  `FakeVocalModel`); the DGX real-mode run produces the actual
  cross-backend table.
- 16 seed prompts at `data/voice-benchmark/prompts.jsonl` covering
  hi/ta/bn/te × {native script, Latin transliteration}.
- ADR 0032 captures the routing addition, the partial flip
  rationale, and the soft-fail contract.

## Files touched

```
services/vocal-synth/app/indicf5.py                 added
services/vocal-synth/app/routing.py                 modified
services/vocal-synth/app/voice_catalog.json         modified
services/vocal-synth/scripts/voice_benchmark.py     added
services/vocal-synth/data/voice-benchmark/prompts.jsonl  added
services/vocal-synth/tests/test_indicf5.py          added
services/vocal-synth/tests/test_routing.py          modified
services/vocal-synth/tests/test_voice_catalog.py    modified
services/vocal-synth/tests/test_voice_benchmark.py  added
docs/DECISIONS/0032-indicf5-vocal-backend.md        added
demos/v1.4/sprint-12-indicf5/ralph-evidence.md      added
demos/v1.4/sprint-12-indicf5/benchmark.md           generated (--dry-run)
demos/v1.4/sprint-12-indicf5/benchmark.jsonl       generated (--dry-run)
```

## Tests added

- `tests/test_indicf5.py` (10 cases) — synthetic ref WAV
  determinism, ref-WAV resolution priority (file > synthetic),
  `synthesise()` dispatch + headers + pad/trim + peak normalise,
  instrumental sections short-circuited.
- `tests/test_routing.py` (2 new cases) — `_pick_backend` routes
  `voice_id=indic_hi_male_broadcast` to `"indicf5"`;
  `indic_kn_male_warm` still routes to `"parler"`; full
  `RoutingVocalModel.synthesise()` dispatches to the IndicF5 spy.
- `tests/test_voice_catalog.py` (2 new cases) — pins which 8
  personas live on IndicF5 in S12 and asserts the kn ones stay on
  Parler.
- `tests/test_voice_benchmark.py` (9 cases) — MOS proxy rubric,
  speaker consistency, prompt-file loader skips comments,
  `--dry-run` end-to-end produces markdown + JSONL with every
  backend column.

## Promise gate

| check | result | evidence |
| --- | --- | --- |
| `pytest vocal-synth` | PASS | 68/68 |
| `ruff check` on Sprint 12 files | PASS | "All checks passed!" on `app/indicf5.py`, `app/routing.py`, `scripts/voice_benchmark.py`, both new tests |
| `pnpm --filter @neo-fm/co-composer test` | PASS | 83/83 (TS mirror catalogue intentionally omits backend) |
| Voice benchmark (--dry-run, 16 prompts × 4 backends) | PASS | 64 cells in `benchmark.md`, JSONL has 64 rows |

```
$ cd services/vocal-synth && uv run pytest -x -q
....................................................................     [100%]
68 passed in 0.27s

$ cd services/vocal-synth && uv run python scripts/voice_benchmark.py \
    --prompts data/voice-benchmark/prompts.jsonl \
    --out ../../demos/v1.4/sprint-12-indicf5/benchmark.md \
    --out-jsonl ../../demos/v1.4/sprint-12-indicf5/benchmark.jsonl \
    --dry-run
wrote ../../demos/v1.4/sprint-12-indicf5/benchmark.md (64 cells across 16 prompts)
```

## Notable decisions

- See ADR 0032 — Why a separate `IndicF5Model`, why only 8/10
  indic_* flip in S12, why a deterministic MOS proxy in CI.
- Soft-fail: missing IndicF5 weights fall through to
  `FakeVocalModel` outside of `NEO_FM_REQUIRE_REAL_MODEL=1` (prod).
- Reference WAVs: filesystem-first with synthetic fallback so CI
  doesn't depend on 16 curated WAVs being checked into the repo.
