# ADR 0036 — RLHF reranker + 100-prompt bench

**Status:** Accepted
**Sprint:** v1.4 Sprint 16
**Date:** 2026-05-17

## Context

The R1 research bundle's strongest claim was that "candidate generation
+ pairwise preference learning" is the single highest-leverage quality
lever for a generative-music product. Until v1.4 we deferred it because
external GPU was the bottleneck. The DGX Spark removes that constraint.

This sprint ships the smallest-possible end-to-end RLHF reranker: a 100-
prompt evaluation harness, top-N candidate generation in the worker,
a pairwise compare UI on `/songs/<id>/compare`, a reward model that
trains on accumulated preference pairs, and the wiring that lets the
reranker pick `is_current=true` post-render.

## Decision

### Eval harness (`evals/v1.4-bench/`)

- 10 styles × 10 prompts. Each prompt carries the language, lyric
  seed, expected raga/tala (or null for non-Indic), target voice
  persona, and duration.
- A standalone YAML parser keeps `pyyaml` off the eval surface so the
  bench loader is safe to run from CI without service deps.
- `run_bench.py` (dry-run default) writes a manifest + per-candidate
  placeholder files; `--apply` lazily imports the worker dispatcher
  on DGX.
- `score_run.py` consumes a manifest and writes per-prompt + per-style
  + overall mean reward. When no trained head exists, a deterministic
  proxy (SHA-256-derived per-candidate scalar) ensures stable summary
  output for CI.

### Reranker (`services/reranker/`)

- Package name: `neofm_reranker` (intentionally distinct so the
  dgx-worker's own `app.*` namespace cannot collide).
- Architecture: ~50k trainable parameters. Two-layer MLP head over a
  pretrained MERT-95M audio encoder. The encoder lives on DGX; CI
  swaps it for a deterministic feature hash so unit tests run anywhere.
- Loss: Bradley-Terry pairwise log-likelihood. Tie votes contribute
  with weight=0.25 (preserves the regularising signal without letting
  ambiguous pairs swamp the gradient).
- Checkpoint format: pure JSON (weights serialised as nested lists) so
  the eval scaffold can load and apply the head with zero torch
  dependency.

### Schema (migration `0041`)

- `tracks.candidate_index integer not null default 0` -- existing rows
  backfill to 0.
- `tracks.is_current boolean not null default true` -- partial unique
  index `tracks_job_current_idx` enforces exactly one current row
  per job.
- Old `tracks_job_id_attempt_id_key` constraint replaced by
  `tracks_job_attempt_candidate_idx` so multiple candidates can share
  an attempt_id.
- New `preference_pairs` table with RLS:
  - Owners can read their own votes.
  - Inserts are funnelled through the `record_preference_pair`
    `SECURITY DEFINER` RPC which validates ownership and per-track
    job membership.

### API (`POST /api/songs/[id]/compare`)

- Zod-validated body `{ winner_track_id, loser_track_id, choice: A|B|tie }`.
- Tie votes set `vote_source='compare-page-tie'` so the reward model
  trainer can weight or drop them later.
- SQLSTATEs: `42501 -> 403`, `P0002 -> 404`, `22023 -> 422`.

### UI (`/songs/[id]/compare`)

- Server-rendered; owner-only via the same RLS path as the main song
  page.
- Picks the current track vs the next-best candidate by
  `candidate_index` and presents both with signed audio URLs.
- Three buttons: A / Tie / B. One-shot per visit; the user can refresh
  the page to vote on another pair.

### Wiring (`bench_dispatch.select_best_candidate`)

- Worker calls into the reranker via `neofm_reranker.score.score_paths`
  to score the N rendered WAVs and picks the highest-scoring as
  `is_current=true`.
- Lazy import keeps the worker boot path independent of the reranker.

### Worker payload (`top_n_candidates`)

- Added to `QueueMessage` with `default=1, ge=1, le=8`.
- `extra="forbid"` was already enabled, so adding a new field is a
  one-line schema change with backward-compatible defaults.

## Alternatives considered

1. **External RLHF service.** Rejected -- adds a network hop and
   bills GPU hours. DGX makes local training affordable.
2. **CLIP-style audio encoder.** Rejected for v1.4 -- MERT-95M is
   purpose-built for music tasks; CLAP / Wav2Vec2 are alternatives we
   may revisit in v1.5.
3. **Train the head jointly with the encoder.** Rejected -- 50k
   trainable params is enough for the data volume we expect from
   internal evals; we can unfreeze the encoder once we have >10k
   preference pairs.
4. **Per-style reranker heads.** Rejected for v1.4 -- the prompt count
   per style (~10) is too small. The shared head still picks up
   per-style structure via the (style, language) fields surfaced in
   `preference_pairs`.

## Soft-fail contract

- Eval scaffold falls back to deterministic proxy when no trained head
  is present.
- Worker falls back to single-candidate rendering when
  `top_n_candidates` is omitted from the payload.
- Compare page shows a "needs >1 candidate" message rather than 500-ing
  when invoked on a single-candidate job.
- `record_preference_pair` RPC validates everything in SQL; the API
  route never needs to fail-open.

## Files

- Migration: `infra/supabase/migrations/0041_preference_pairs_and_candidates.sql`
- Eval: `evals/v1.4-bench/prompts/*.yaml`, `evals/v1.4-bench/scripts/*.py`,
  `evals/v1.4-bench/tests/test_bench_loader.py`
- Reranker: `services/reranker/neofm_reranker/*.py`,
  `services/reranker/tests/test_*.py`
- Worker hook: `services/dgx-worker/app/bench_dispatch.py`,
  `services/dgx-worker/app/models.py` (`top_n_candidates`)
- API: `apps/web/app/api/songs/[id]/compare/route.ts`,
  `apps/web/tests/app/api/compare.test.ts`
- UI: `apps/web/app/(app)/songs/[id]/compare/page.tsx`,
  `apps/web/app/(app)/songs/[id]/compare/compare-form.tsx`
