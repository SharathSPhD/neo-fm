# neo-fm lyric-gen

Indic lyric generation sidecar (v1.4 Sprint 7). FastAPI service that wraps
a fine-tuned `ai4bharat/IndicBART` checkpoint hosted on HF Hub as
`neo-fm/lyric-gen-indicbart-v1`. The model is trained locally on the DGX
Spark (GB10) per the v1.4 plan; this service is the inference seam used
by the worker and by `IndicBARTLyricProvider` in `@neo-fm/lyrics` when
the public-domain corpus has no match for a request.

## Status

- Sprint 7 ships the **service scaffold + dataset prep + train script +
  eval harness + provider seam**. The actual SFT run is operator-owned
  and happens on DGX; this code does not assume a checkpoint is on disk.
- `LYRIC_GEN_BACKEND=fake` (the default in CI / docker-compose) wires
  `FakeLyricGenModel` which deterministically templates over Sprint 6
  PD scaffolding so the worker integration tests have stable bytes.
- `LYRIC_GEN_BACKEND=indicbart` is the production path. It lazy-imports
  `transformers` and loads either:
  - a local checkpoint path (`LYRIC_GEN_MODEL_DIR`), or
  - a HF Hub adapter id (`LYRIC_GEN_HF_ADAPTER`, default
    `neo-fm/lyric-gen-indicbart-v1`).

## Endpoints

- `GET /healthz` — backend + model-loaded status.
- `GET /metrics` — Prometheus exposition.
- `POST /v1/generate-lyric` — HMAC-authenticated. Body schema is
  `GenerateLyricRequest` in `app/serve.py`. Response is a JSON object
  with the generated lyric body, per-section stanzas, syllable counts,
  and a `provenance` block (model version, decode params).

## Training

```bash
uv sync --extra training
uv run python scripts/prepare_dataset.py --out data/lyric-gen-corpus
uv run python train.py \
  --dataset data/lyric-gen-corpus \
  --output-dir runs/sft-v1 \
  --epochs 5 --lr 3e-5 --batch-size 8 --grad-accum 4 --bf16
```

See `docs/DECISIONS/0027-indicbart-lyric-gen.md` (local) for the full
recipe, hyperparameters, and eval rubric.

## Eval

```bash
uv run python scripts/eval.py \
  --checkpoint runs/sft-v1 \
  --eval-set data/lyric-gen-corpus/eval.jsonl \
  --out evals/lyric-gen-v1.json
```

Eval gates:

- G2P round-trip via `@neo-fm/g2p` — zero unknown tokens.
- Syllable-count hit ratio: ≥ 0.7 across all languages.
- LLM-as-judge meter+relevance score: ≥ 3.5/5 median on 30
  samples/language.
