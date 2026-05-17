# services/reranker — v1.4 RLHF reward model

Sprint 16 reranker:
- Architecture (planned, runs on DGX): pretrained MERT-95M audio
  encoder (frozen) + 2-layer MLP head (~50 k trainable params).
- Training data: `public.preference_pairs` table (migration 0041)
  joined to `tracks.url` for the signed audio path.
- Output: a `scores.json` checkpoint under `checkpoints/<run>/`,
  symlinked to `checkpoints/latest/`. The reranker scoring path in
  `evals/v1.4-bench/scripts/score_run.py` reads this file.

## Layout

```
services/reranker/
├── neofm_reranker/          # distinct top-level package name so the
│   ├── __init__.py          #   dgx-worker can import this from its
│   ├── data.py              #   own `app.*` namespace without colliding
│   ├── model.py             #   (see app/bench_dispatch.py).
│   ├── train.py
│   └── score.py
├── scripts/
│   └── export_dataset.py    # pull preference_pairs from Supabase
├── checkpoints/
│   └── latest/
│       └── head.json        # written by `train.py`
└── tests/
    ├── test_data.py
    ├── test_model.py
    └── test_train.py
```

## Why two stages (data export, then train)?

- The Supabase fetch needs a service-role key and direct DB access; it
  must run on the operator's box, not on every CI machine.
- The training loop must be reproducible offline. By materialising the
  dataset to parquet first, we get a fixed training corpus we can hash
  and version (`dataset-<sha256>.parquet`).

## CI: dry-run path

In CI we cannot pull audio from production or train a real model. The
test suite covers:

- `test_data.py` — synthetic 100-row dataset, splits, label encoding.
- `test_model.py` — forward pass shapes, deterministic init.
- `test_train.py` — `train(dry_run=True)` writes a stub `scores.json`
  via the deterministic proxy from `evals/v1.4-bench/scripts/score_run.py`.
  This is what allows `score_run.py` to fall back to a stable summary
  when no real checkpoint is present.

## Wiring into the worker

When `top_n_candidates > 1` is set on a job's payload, the worker
renders all N candidates, calls
`services.dgx_worker.app.bench_dispatch.select_best_candidate` (which
internally calls `neofm_reranker.score.score_paths`) on the resulting
WAVs, and writes the highest-scoring row with `is_current=true`.
Migration 0041 introduces the schema columns necessary for this.
