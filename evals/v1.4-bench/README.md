# v1.4 internal benchmark

100 curated prompts (10 styles × 10 prompts each) covering the v1.4 surface area.
Used by Sprint 16's RLHF reranker to seed the preference-pair collection and to
score per-engine quality uplift.

## Layout

```
evals/v1.4-bench/
├── prompts/                # 10 style files, 10 prompts each (YAML)
│   ├── carnatic.yaml
│   ├── hindustani.yaml
│   ├── bhavageete.yaml
│   ├── tamil-folk.yaml
│   ├── bollywood.yaml
│   ├── kabir.yaml
│   ├── tagore.yaml
│   ├── western.yaml
│   ├── sanskrit-shloka.yaml
│   └── rabindrasangeet.yaml
├── runs/<utc-timestamp>/    # output of `python -m bench.run <engine>`
│   ├── manifest.json
│   └── candidates/<prompt-id>/<seed>.wav
└── scripts/
    ├── bench_loader.py     # parse YAML -> Prompt dataclasses
    ├── run_bench.py        # invoke worker/cli for each prompt, persist outputs
    └── score_run.py        # reward-model score a run, write summary.json
```

## Prompt shape

Each prompt YAML row carries:

```yaml
id: carnatic-001
style: carnatic
language: hi              # 'sa' for Sanskrit, etc.
lyrics_seed: ...          # 1-3 line lyric or first phrase
expected:
  raga: kalyani
  tala: adi
  voice_persona: indic_hi_female_lyrical
duration_seconds: 60
```

This shape is consumed by `scripts/bench_loader.py:Prompt`.

## Run protocol

1. **Smoke locally first.** `python -m evals.v1.4-bench.scripts.bench_loader`
   prints the parsed prompt count (should be 100).
2. **Render N candidates.** On the DGX box, `python -m
   evals.v1.4-bench.scripts.run_bench --engine current --top-n 4` enqueues
   400 jobs (100 prompts × 4 seeds) through the worker and writes the
   resulting WAVs under `runs/<utc>/candidates/`.
3. **Score.** `python -m evals.v1.4-bench.scripts.score_run runs/<utc>` loads
   the reranker checkpoint (`services/reranker/checkpoints/latest/`) and
   writes `summary.json` with per-prompt top-1 selection + per-style mean
   reward.
4. **Compare runs.** Use the per-style mean reward delta vs a previous run
   to demonstrate quality uplift (target ≥ 0.3 MOS uplift over random
   selection per the plan).

## Why 10 × 10 and not larger

- 100 prompts is large enough to surface per-style differences and small
  enough that 4× candidate generation on DGX finishes inside a sprint.
- The reranker training data comes from preference pairs (collected via the
  compare UI), not from the bench itself; the bench is the *evaluation*
  scaffold.
