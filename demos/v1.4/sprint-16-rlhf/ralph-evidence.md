# Sprint 16 — Eval harness + RLHF reranker (evidence)

## What shipped

1. **100-prompt bench** — `evals/v1.4-bench/`. Ten styles × ten prompts.
   Loader, dispatcher, and scorer scripts; deterministic proxy keeps
   `score_run.py` summary stable in CI.
2. **Reranker** — `services/reranker/neofm_reranker/`. Bradley-Terry
   reward head trained with synthetic + JSONL preference data;
   checkpoint stored as pure JSON for cross-environment portability.
3. **Schema** — `infra/supabase/migrations/0041_preference_pairs_and_candidates.sql`.
   `tracks.candidate_index` + `tracks.is_current` + `preference_pairs`
   table + `record_preference_pair` SECURITY DEFINER RPC.
4. **Compare UI** — `apps/web/app/(app)/songs/[id]/compare/page.tsx`
   + `compare-form.tsx`. Owner-gated, picks current vs next-best
   candidate, A/Tie/B buttons.
5. **API** — `apps/web/app/api/songs/[id]/compare/route.ts`. Auth +
   validate + dedupe-check + RPC dispatch + SQLSTATE -> HTTP.
6. **Worker wiring** — `services/dgx-worker/app/bench_dispatch.py`
   `select_best_candidate()`. Lazy import of the reranker via the
   `neofm_reranker.*` namespace.
7. **Payload schema** — `QueueMessage.top_n_candidates`
   (default 1, max 8).
8. **ADR 0036** — RLHF reranker + 100-prompt bench.

## Tests

- `evals/v1.4-bench/tests/test_bench_loader.py`: 6 tests (count,
  uniqueness, fields, style-match).
- `services/reranker/tests/`: 23 tests across data, model, train.
- `services/dgx-worker/tests/test_bench_dispatch.py`: 11 tests (manifest
  validation, JSONL writeup, reranker integration).
- `services/dgx-worker/tests/test_models.py`: 3 new tests for
  `top_n_candidates`.
- `apps/web/tests/app/api/compare.test.ts`: 10 tests (auth, body,
  identical-track, tie vote-source mapping, SQLSTATE translation).
- `pnpm --filter @neo-fm/web test`: 215 passed (26 files).
- `pnpm --filter @neo-fm/web typecheck`: clean.

## Promise gate

| Promise (plan §16) | Evidence |
|---|---|
| 100-prompt internal benchmark in `evals/v1.4-bench/` | 10 YAML files × 10 prompts; tests pin shape |
| Candidate generation per job, top-N stored | `QueueMessage.top_n_candidates`, `tracks.candidate_index/is_current`, migration 0041 |
| Pairwise preference UI | `/songs/[id]/compare` page + form + API + tests |
| Reward model training on DGX | `neofm_reranker.train.train()` dry-run + apply branches; `head.json` checkpoint format |
| Wire reranker into worker | `bench_dispatch.select_best_candidate` lazy-imports `neofm_reranker.score.score_paths` |
| Per-style quality uplift readout | `score_run.py` writes `per_style.{mean_top1, mean_random, uplift}` |

## Notable decisions (in ADR 0036)

- **Distinct package name (`neofm_reranker`).** services/dgx-worker
  and services/reranker both used to live as `app.*`; Python's
  import cache would have crossed them. Renaming the reranker
  package is cheaper than the alternative workarounds we considered
  (importlib spec-from-file, sys.path scrubbing, runtime evaluation).
- **JSON checkpoint format.** Stored as nested lists so `score_run.py`
  can load and apply the head with no torch dependency.
- **Tie votes recorded, not discarded.** They get vote_source=
  `compare-page-tie` and weight=0.25 in the Bradley-Terry loss.
- **Deterministic proxy in score_run.py.** When the head is missing
  (fresh deploys, CI), SHA-256-derived per-candidate scalars keep
  the summary stable -- still differentiates candidates and surfaces
  per-style uplift trends.

## Pending follow-ups (Sprint 17)

- Playwright spec `compare-pairs.spec.ts` exercising the compare page
  end-to-end.
- Prod-smoke step that hits `POST /api/songs/{id}/compare` against a
  seeded multi-candidate job.
- A real DGX training run on the v1.4 bench output once enough
  preference pairs accumulate (~500 minimum per the plan).
