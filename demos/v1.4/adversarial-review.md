# v1.4 adversarial review

Date: 2026-05-17

Branch reviewed: `main` at `ac83d38` plus audit branch
`review/v1.4-adversarial-audit`.

Reviewer mode: adversarial project review, with a delegated
`ce-adversarial-reviewer` pass plus direct code, script, CI, and
Playwright evidence gathering.

## Executive verdict

v1.4 materially expanded the repository's surface area: schema
extensions, more presets, voice catalogue UI scaffolding, background
music controls, seed scripts, new service packages, reranker scaffolding,
and a 25-step production smoke harness. However, measured against the
uploaded v1.4 plan and the repository's own `AGENTS.md` phase-gating
contract, the 17-sprint cycle did not meet the stated completion bar.

The project is in a "scaffolded v1.4" state, not a proven "trained and
shipped v1.4" state.

Highest risk findings:

1. `main` is not green. GitHub CI for the v1.4 merge is failing in both
   the contracts job and the TypeScript job.
2. The live production app is not showing the v1.4 surfaces. The 25-step
   production smoke is red: no voice picker, no advanced disclosure, only
   8 presets, no public Discover songs, and no live evidence of the new
   style filters or compare flow.
3. The RLHF/top-N reranker is not wired into the production worker hot
   path. `top_n_candidates` exists in the queue model, but
   `services/dgx-worker/app/worker.py` still generates, uploads, inserts,
   and completes exactly one track.
4. Migration `0041` changes the `tracks` uniqueness model to
   `(job_id, attempt_id, candidate_index)`, but `WorkerDB.insert_track`
   still inserts with `on conflict (job_id, attempt_id) do nothing`.
   That is likely a runtime failure once the migration is applied.
5. Most model-training claims are dry-run, placeholder, or operator-only
   stubs. HeartMuLa LoRA, MusicGen LoRA, Stable Audio stems, chant LoRA,
   and NeMo training paths either raise `NotImplementedError`, emit empty
   placeholder artifacts, or require an uncommitted external operator
   path.
6. MOS/uplift claims are not backed by committed, reproducible listening
   evaluation artifacts. Several benchmark artifacts explicitly say
   `Dry-run: True` and show synthetic `5.00` proxy scores.
7. The documented merge gate says several gates still need post-merge
   operator action, but the sprint todo was marked complete anyway.

## Review basis

Primary contract documents:

- Uploaded plan:
  `/home/sharaths/.cursor/projects/home-sharaths-projects-neo-fm/uploads/neo-fm_v1.4_deep-dive_f76f15ee.plan-L1-L558-0.md`
- Repository phase contract: `AGENTS.md`
- Merge/evidence docs:
  `demos/v1.4/merge-gate.md`,
  `demos/v1.4/sprint-17-qa-merge/ralph-evidence.md`,
  `docs/OPERATOR-HANDOFF.md`

Key verification commands run during this audit:

```sh
gh run list --branch main --limit 5
gh run view 25996601543 --log-failed
pnpm -r typecheck
python3 -m pytest -q --tb=short
  # from services/dgx-worker
python3 -m pytest -q
  # from services/reranker
python3 -m pytest -q
  # from evals/v1.4-bench
pnpm --filter @neo-fm/web exec playwright test \
  tests/e2e/sprint-17/discover-non-empty.spec.ts --reporter=list
pnpm --filter @neo-fm/web exec playwright test \
  tests/e2e/sprint-17/compare-pairs.spec.ts --reporter=list
SMOKE_OUT=/tmp/neo-fm-v1.4-audit-smoke \
  node infra/scripts/prod-smoke.mjs
```

## Hard evidence summary

| Area | Evidence | Status |
| --- | --- | --- |
| GitHub CI | `gh run view 25996601543 --log-failed` | Failing |
| Recursive TypeScript | `pnpm -r typecheck` | Failing |
| Contracts job | Missing `docs/contracts/queue-message.schema.json` | Failing |
| Full DGX worker pytest | `ModuleNotFoundError: soundfile` during collection | Failing locally |
| Reranker unit tests | `23 passed` | Passing, but only dry-run/proxy path |
| Bench loader tests | `6 passed` | Passing, but bench dry-run uses placeholders |
| Live Discover e2e | no `a[href^="/p/"]` found | Failing |
| Live compare e2e | skipped due no multi-candidate tracks | Not proven |
| Live prod smoke | 12/25 pass, 13 fail or ineffective | Failing |

## 1. Contract and phase-gate assessment

`AGENTS.md` says a phase advances only if all five hold:

1. CI green for `ts`, `py`, `contracts`, and `docker-build`.
2. Containers build and start on the real DGX where applicable.
3. Real, listenable output for at least one real input; no mocks count as
   real.
4. Reproducible demo artifacts are committed and regenerable from the
   merged SHA.
5. Adversarial review is completed before merge, with blocker findings
   resolved or filed.

The v1.4 merge does not satisfy this contract.

### CI is red

Recent GitHub Actions:

```text
completed failure docs(v1.4): stamp merge SHA 82feb5b into merge-gate.md ci main push 25996601543
completed success docs(v1.4): stamp merge SHA 82feb5b into merge-gate.md docker-build main push 25996601538
```

Failed CI details:

- Contracts job:
  `FileNotFoundError: docs/contracts/queue-message.schema.json`
- TypeScript job:
  `packages/style-presets/src/index.test.ts(33,47): error TS2339:
  Property 'voice_id' does not exist on type ...`

Local confirmation:

```text
pnpm -r typecheck
packages/style-presets typecheck:
src/index.test.ts(33,47): error TS2339: Property 'voice_id' does not exist...
```

The TypeScript failure is not incidental. `SongDocumentSchema` defines
`voice_id` at the document level, but the style preset test checks
`sections.some((s) => s.voice_id === "indic_bn_female")`. Section schema
does not include `voice_id`, so the test encodes an invalid contract.

### Contracts are missing

`.github/workflows/ci.yml` validates:

- `docs/contracts/queue-message.schema.json`
- `docs/contracts/openapi-cloud.yaml`
- `docs/contracts/openapi-dgx.yaml`

In the repository:

```text
test -e docs/contracts/queue-message.schema.json -> missing
test -e docs/contracts/openapi-cloud.yaml -> missing
test -e docs/contracts/openapi-dgx.yaml -> missing
```

This means the CI contract job cannot pass on `main`. It also means the
queue/API contract was not updated alongside `top_n_candidates`,
candidate tracks, compare votes, or the new worker/service surfaces.

### Production smoke is red

The audit ran the new 25-step production smoke against
`https://neo-fm-web.vercel.app`.

Summary from `/tmp/neo-fm-v1.4-audit-smoke/SUMMARY.md`:

- Overall: `RED`
- Steps 1-12 mostly pass on the old v1.3-era surfaces.
- Step 13 `13-voice-picker`: fail, `visible=false, rows=0`
- Step 14 `14-advanced-disclosure`: fail, no Advanced button visible
- Step 15 `15-preset-chip-count`: fail, saw 8 presets:
  `carnatic-kriti`, `hindustani-khayal-sketch`,
  `kannada-bhavageete`, `kabir-doha`, `tagore-set`,
  `bollywood-ballad`, `tamil-folk`, `western-pop`
- Steps 16-18 for Sanskrit/Bengali/Telugu Discover filters return
  `cardCount=0`
- Step 19 `19-public-song-page`: fail, no public songs on Discover
- Step 20 `20-variation-dialog`: fail, no public song page/CTA
- Step 21 `21-compare-page`: timeout
- Step 22 `22-batch-publish-bar`: navigation aborted
- Step 25 `25-public-audio-url`: navigation aborted

This is decisive end-user evidence: the live app does not show the v1.4
experience claimed by Sprint 15-17.

## 2. Objective-by-objective sprint assessment

Verdict scale:

- Achieved: code and tests indicate the intended behavior is wired.
- Partial: scaffold exists but with gaps, missing evidence, or weak tests.
- Not proven: evidence is dry-run, skipped, external, or not live.
- Contradicted: code/tests/live behavior contradict the claimed outcome.

| Sprint | Plan objective | Audit verdict |
| --- | --- | --- |
| 0 | Preflight, DGX rule, worktree, ADR/evidence template | Partial. Worktree/commits exist, but phase-gating contract was later violated. |
| 1 | Favorites RLS, cover-art template, Discover parity, seed scaffold | Partial. RPC/schema work exists, but live Discover is empty and smoke proves old filters. |
| 2 | SongDocument v1.4 schema widening, `voice_id`, BackgroundMix | Partial. Schema widened, but `voice_id` semantics are confused in style-presets test. Contracts missing. |
| 3 | Shared Variation/Remix dialogs and APIs | Partial. Code/specs exist, but live smoke cannot reach public variation because Discover has no public songs. |
| 4 | Background music advanced UX + user presets | Not live. Code likely exists, but live smoke fails to find Advanced controls. |
| 5 | Voice catalog, picker, previews, worker `voice_id` | Not live. Code exists, but live smoke finds no picker and zero voice rows. |
| 6 | Indic lyric corpus expansion/provenance | Partial. Corpus/docs/scripts exist, but full provenance and production use were not deeply proven here. |
| 7 | IndicBART lyric-gen training + sidecar | Partial. Sidecar/training script exists, but real training checkpoint evidence is not committed. |
| 8 | Bhavageete LoRA on HeartMuLa, MOS, deploy | Not proven. Real trainer path raises `NotImplementedError`. |
| 9 | Tamil-folk LoRA on HeartMuLa, MOS, deploy | Not proven. Same HeartMuLa LoRA trainer limitation. |
| 10 | MusicGen Indic-style adapters and A/B routing | Partial. Routing code exists; MusicGen trainer real path raises `NotImplementedError`. |
| 11 | Stable Audio stems + transitions | Partial. Worker/mixer hooks exist; training/curation real paths are dry-run or `NotImplementedError`. |
| 12 | IndicF5 vocal backend + MOS/WER benchmark | Partial. Routing exists; benchmark artifacts say `Dry-run: True` and use proxy scores. |
| 13 | Custom NeMo Kannada TTS training | Not proven. Dry-run emits one-byte `.nemo` placeholders; no real training artifact in repo. |
| 14 | Sanskrit chant corpus + style adapter | Not proven. Dry-run emits empty `chant_style_lora.safetensors`; live Sanskrit Discover empty. |
| 15 | Discover seeding + batch publish | Contradicted on production. Seed manifest says `"apply": false`; live Discover has no public cards. |
| 16 | Eval harness + RLHF/RLAIF reranker + top-N wiring | Contradicted for worker wiring. Bench/reranker scaffolds exist, but production worker ignores top-N. |
| 17 | QA, prod-smoke, advisors, Vercel READY, post-merge smoke | Contradicted. CI red, prod-smoke red, deploy table still pending, Lighthouse not captured. |

## 3. Architecture gaps

### 3.1 RLHF/top-N is not on the job execution path

`services/dgx-worker/app/models.py` adds:

```py
top_n_candidates: int = Field(default=1, ge=1, le=8)
```

But `services/dgx-worker/app/worker.py` still does a single generation:

```py
audio_bytes = await inference.generate(
    request_body=build_inference_request(message, song_document),
    trace_id=message.trace_id,
)
```

Then it uploads one object:

```py
object_path = storage.object_path(job_id, str(message.attempt_id), "wav")
```

Then it inserts one track:

```py
db.insert_track(... url=storage.storage_url(object_path), ...)
db.mark_completed(...)
```

No loop over `top_n_candidates`, no multiple candidate storage paths, no
call to `select_best_candidate`, no update of `is_current`, no writes
with `candidate_index`.

The actual reranker scoring function is in
`services/dgx-worker/app/bench_dispatch.py`, which describes itself as a
bench dispatcher and says a separate `bench_runner` is out of scope.
That is not production worker integration.

### 3.2 Tracks migration and worker insert conflict target are incompatible

Migration `0041_preference_pairs_and_candidates.sql` drops the old
`tracks_job_id_attempt_id_key` and creates:

```sql
create unique index if not exists tracks_job_attempt_candidate_idx
  on public.tracks (job_id, attempt_id, candidate_index);
```

But `services/dgx-worker/app/db.py` still does:

```sql
insert into public.tracks
  (job_id, attempt_id, url, duration_seconds, format, bytes, expires_at)
values (...)
on conflict (job_id, attempt_id) do nothing;
```

If the old unique constraint is actually dropped, Postgres cannot infer
an arbiter for `on conflict (job_id, attempt_id)`. This is likely a
runtime error on successful job completion, exactly where the worker
should insert its track row.

### 3.3 Contract drift between docs, tests, and code

Examples:

- `demos/v1.4/merge-gate.md` says migrations `0035_voice_catalog.sql`,
  `0036_indic_corpus_audit.sql`, and `0037_user_presets.sql` exist.
  Actual migration names are:
  - `0035_jobs_favorite_security_definer.sql`
  - `0036_cover_art_template.sql`
  - `0037_song_doc_v1_4_widening.sql`
  - `0038_user_presets.sql`
  - `0039_voice_samples_bucket.sql`
  - `0040_publish_song_batch.sql`
  - `0041_preference_pairs_and_candidates.sql`
- `.github/workflows/ci.yml` references `docs/contracts/*`, but the
  repo does not contain `docs/contracts`.
- `apps/web/tests/e2e/sprint-17/compare-pairs.spec.ts` says the worker
  generates multi-candidate tracks when `top_n_candidates > 1`, but the
  worker does not.
- `services/reranker/neofm_reranker/score.py` says it is used by the
  worker, but no production worker path imports it.

### 3.4 Silent fallbacks hide missing model deployments

Several service modules are designed to boot without real model
dependencies and fall back to fake or deterministic behavior unless
operator-only flags/envs are set. That is useful for CI, but it blurs
the line between "surface compiles" and "model shipped."

For release-level claims, the project needs a manifest of real artifact
hashes and runtime health checks proving each adapter/backend is loaded,
not just loadable in principle.

## 4. Model and tuning evidence

### 4.1 HeartMuLa LoRA training did not happen in-repo

`services/music-inference/scripts/_lora_trainer.py`:

```py
def _real_train(args: argparse.Namespace) -> int:
    ...
    raise NotImplementedError(
        "DGX trainer integration is operator-only at this commit; "
        "see docs/DECISIONS/0028 + 0029 for the runbook."
    )
```

This affects Sprint 8 and Sprint 9 claims:

- Bhavageete LoRA on HeartMuLa
- Tamil-folk LoRA on HeartMuLa

There may be out-of-repo operator runs, but the repository does not
contain a real trainer, artifact hash, or replayable training log.

### 4.2 MusicGen LoRA training is also operator-only/stubbed

`services/music-inference/scripts/_musicgen_lora_trainer.py`:

```py
raise NotImplementedError(
    "DGX trainer integration is operator-only at this commit; "
    "see docs/DECISIONS/0030 for the runbook."
)
```

The routing and model adapter surfaces are meaningful, but the claimed
trained Carnatic/Hindustani adapters are not proven by committed
artifacts.

### 4.3 Stable Audio stems training is not implemented

`services/stems-synth/scripts/train_stems_lora.py`:

```py
raise NotImplementedError(
    "DGX trainer integration is operator-only at this commit; "
    "see docs/DECISIONS/0031 for the runbook."
)
```

This weakens Sprint 11's "fine-tune short-clip adapter" claim.

### 4.4 NeMo Kannada TTS dry-run emits placeholders

`services/vocal-synth/scripts/train_kannada_nemo.py` dry-run:

```py
(out_dir / "fastpitch.nemo").write_bytes(b"\x00")
(out_dir / "hifigan.nemo").write_bytes(b"\x00")
```

The code also has a non-dry path with NeMo imports, but the committed
benchmark evidence is dry-run/proxy, not a training proof.

### 4.5 Chant style adapter dry-run emits empty LoRA

`services/vocal-synth/scripts/train_chant_style_lora.py`:

```py
(out_dir / "chant_style_lora.safetensors").write_bytes(b"\x00")
```

The repository contains:

- `demos/v1.4/sprint-14-chant/adapter/adapter_config.json`
- `demos/v1.4/sprint-14-chant/adapter/svara_calibration.json`

But not a real non-empty trained adapter artifact.

### 4.6 RLAIF/RLHF role: UI and dry-run scoring, not closed-loop tuning

What exists:

- `preference_pairs` table and `record_preference_pair` RPC.
- `/songs/[id]/compare` page and API route.
- `services/reranker/neofm_reranker` dry-run reward-head training.
- `evals/v1.4-bench` prompt suite and score scripts.
- `bench_dispatch.select_best_candidate` for bench-side scoring.

What is missing:

- Worker hot-path top-N generation.
- Worker hot-path reranker selection.
- Evidence that live `preference_pairs` exist and were used to train.
- A real MERT-95M `train_apply.py` implementation in the repo.
- Real generated audio artifacts for the 100-prompt bench.
- A reproducible artifact backing the claimed `+0.288 MOS` uplift.

`services/reranker/neofm_reranker/train.py` says the apply path imports:

```py
from .train_apply import train_with_torch
```

but that module is not present in the committed tree. The error message
also references the old path `services/reranker/app/train_apply.py`,
which no longer matches the package rename to `neofm_reranker`.

Conclusion: RLAIF/RLHF did not succeed in tuning the production product
in this merge. It created the data model, UI, and a dry-run scoring
scaffold. It did not close the loop from user vote -> model training ->
worker candidate selection.

## 5. Frontend and end-user completeness

### 5.1 Production is still effectively v1.3 on key creation surfaces

The production smoke found only 8 presets on `/songs/new`. The v1.4
plan and Sprint 15 evidence claim 11 presets and three new styles.

Smoke evidence:

```text
15-preset-chip-count FAIL expected >=9 v1.4 presets, saw 8:
["carnatic-kriti","hindustani-khayal-sketch","kannada-bhavageete",
"kabir-doha","tagore-set","bollywood-ballad","tamil-folk","western-pop"]
```

It also failed to find:

- voice picker
- advanced disclosure
- public Discover rows
- public variation flow
- compare page
- batch publish bar

### 5.2 Discover is empty in live production

Playwright result:

```text
tests/e2e/sprint-17/discover-non-empty.spec.ts
Locator: locator('a[href^="/p/"]').first()
Expected: visible
Timeout: 15000ms
Error: element(s) not found
```

The error context shows the page rendering:

```text
No songs match this filter yet. Be the first to publish one.
```

This contradicts Sprint 15's objective of a 12-demo Discover seed.

The committed seed manifest itself says:

```json
{
  "apply": false,
  "preset_count": 12
}
```

So the committed evidence proves the planned matrix, not the applied
production seed.

### 5.3 E2E tests mask missing core behavior

`compare-pairs.spec.ts` gracefully skips when fewer than two audio
candidates exist:

```ts
test.skip(
  audioCount < 2,
  "Compare page requires >=2 candidate tracks; seed not yet generating top-N",
);
```

The live run skipped. Given the worker does not generate top-N, this
skip is not a temporary fixture issue; it is hiding the missing product
path.

### 5.4 Sprint 17 prod-smoke is too weak on card counts

Steps 16-18 count cards for Sanskrit/Bengali/Telugu Discover pages but
do not fail when `cardCount=0`. In the audit smoke, all three passed
despite zero cards. That means the smoke harness can report green for
the exact end-user failure it was meant to detect.

## 6. Backend, database, and API gaps

### 6.1 Queue/API contracts are not versioned with implementation

The queue model has `top_n_candidates`, but `docs/contracts` does not
exist, and CI fails trying to validate it. External producers and worker
consumers have no authoritative committed schema for the new field.

### 6.2 Batch publish likely has API-level tests but no production proof

`publish_song_batch` and the web route have targeted tests. However,
the live smoke step for the batch publish bar failed, and the live
Discover feed is empty. This suggests the path may be implemented but
not product-complete/deployed.

### 6.3 `record_preference_pair` is only useful if candidate rows exist

The compare RPC can record a vote for two tracks on one job. But the
worker creates only one track per job. Unless rows are manually inserted
or generated by an out-of-band bench runner, the product cannot
naturally create the pairs the UI needs.

### 6.4 CI does not enforce claimed Python test surface

`demos/v1.4/merge-gate.md` claims:

- vocal-synth 128 passed, 1 skipped
- reranker 23/23
- lyric-gen 22/22
- cover-art-synth 14/14
- stems-synth 31/31
- evals/v1.4-bench 6/6

But `.github/workflows/ci.yml` Python matrix only includes:

- `packages/song-doc/python`
- `services/music-inference`
- `services/dgx-worker`

The merge-gate test totals are local/manual, not enforced on pull
request or push.

## 7. Test coverage gaps

### Strong coverage areas

- Many schema and route-level Vitest tests exist.
- Reranker unit tests are focused and deterministic.
- Bench loader tests assert 100-prompt shape.
- Some service test suites are large and useful.

### Weak or misleading coverage areas

- Full recursive typecheck fails.
- Full DGX worker pytest fails to collect locally.
- Live Playwright tests fail or skip on the new v1.4 surfaces.
- CI contract files are absent.
- Top-N worker behavior has no integration test because it is not
  implemented in the worker.
- Model training tests mostly assert dry-run outputs.
- MOS tests are proxy/heuristic, not human listening evaluation.
- The seed/discover test assumes seeded production data but the seed
  manifest is dry-run.
- Prod-smoke accepts `cardCount=0` as pass for several critical v1.4
  Discover checks.

## 8. Architecture recommendations

### P0 - stop the release bleeding

1. Revert or hotfix `main` until CI is green. `AGENTS.md` explicitly
   says main must have passing CI and working demos.
2. Restore `docs/contracts/*` or remove/update the CI contracts job.
   Prefer restoring contracts:
   - `queue-message.schema.json`
   - `openapi-cloud.yaml`
   - `openapi-dgx.yaml`
3. Fix the `packages/style-presets` type error:
   - Either move the Bengali preset assertion from `sections[].voice_id`
     to document-level `song_document.voice_id`, or extend
     `SectionSchema` intentionally and update the worker/co-composer
     contract. Do not keep a test that encodes an invalid type.
4. Fix `WorkerDB.insert_track` to match migration `0041`:
   - include `candidate_index`
   - use `on conflict (job_id, attempt_id, candidate_index)`
   - set `is_current` explicitly
   - update tests for migrated schema behavior
5. Make the production smoke fail when v1.4 Discover card counts are
   zero. The current pass-on-zero behavior hides the core failure.

### P0 - decide whether RLHF is real in v1.4

Choose one:

1. Implement it:
   - in `worker.py`, generate `top_n_candidates` candidates
   - include candidate-specific seeds/object paths
   - insert every candidate with `candidate_index`
   - score candidates with `select_best_candidate`
   - update `is_current`
   - expose current track consistently in web queries
   - add integration tests for `top_n_candidates=4`
2. Or demote it:
   - remove "wired reranker" claims
   - describe it as "preference collection and offline reranker scaffold"
   - keep top-N hidden until worker support is real

### P1 - separate real training from scaffold

Create an explicit artifact matrix:

| Artifact | Expected file/repo | Evidence required |
| --- | --- | --- |
| Bhavageete HeartMuLa LoRA | HF repo + local checksum | non-dry training log, config, sample WAV, MOS |
| Tamil-folk HeartMuLa LoRA | HF repo + local checksum | same |
| MusicGen Carnatic LoRA | HF repo + checksum | same |
| MusicGen Hindustani LoRA | HF repo + checksum | same |
| Stable Audio stems adapter | checkpoint + checksum | sample stem/fill WAVs |
| NeMo Kannada FastPitch/HiFi-GAN | `.nemo` files + checksum | benchmark with real WAVs |
| Chant style adapter | non-empty `.safetensors` + checksum | sample chant WAVs |
| Reranker head | `head.json` + dataset hash | before/after score distribution |

No artifact should count as shipped if its trainer raises
`NotImplementedError` or writes placeholder bytes.

### P1 - make model health observable

Add service health endpoints that report loaded model state:

- model family
- checkpoint/adapter path
- adapter checksum
- whether fallback/fake mode is active
- load error, if any

The web/operator handoff should not rely on prose claims. It should be
able to query the live stack and see whether v1.4 adapters are loaded.

### P1 - strengthen frontend completeness

1. Provision deterministic e2e fixtures:
   - at least one public song
   - at least one completed private song
   - at least one job with two candidate tracks
   - at least one unpublished completed song for batch publish
2. Remove skips from critical e2e specs or mark skipped specs as release
   blockers.
3. Add assertions that v1.4-specific UI exists on the live deploy:
   - 11 presets
   - voice picker rows
   - advanced disclosure controls
   - Sanskrit/Bengali/Telugu Discover filters
   - public song page with variation CTA
   - compare page with 2 audio candidates
4. Make production smoke produce a committed summary for the release
   SHA before marking Sprint 17 complete.

### P1 - expand CI to match merge-gate claims

Add jobs for:

- `services/vocal-synth`
- `services/reranker`
- `services/lyric-gen`
- `services/stems-synth`
- `services/cover-art-synth`
- `evals/v1.4-bench`
- Playwright smoke subset against either local seeded app or a staging
  deployment

Do not claim these as release gates unless CI enforces them or the
operator evidence is committed and regenerable.

### P2 - clarify docs and release narrative

1. Update `demos/v1.4/merge-gate.md` migration table to actual file
   names.
2. Replace "MOS uplift" language with "proxy score" where applicable.
3. Add a "stubbed / dry-run only" section for each model path until real
   artifacts exist.
4. Move v1.4 status to one of:
   - "scaffold complete"
   - "runtime integration complete"
   - "trained artifact complete"
   - "production verified"

Right now those states are conflated.

## 9. End-user perspective

From the user's point of view on the live app:

- Landing, pricing, library, account, and old creation canvas still
  mostly work.
- The promised v1.4 creation improvements are not visible on production
  in the audit smoke.
- Discover has no public demos, so users cannot experience the claimed
  new styles or voices.
- Pairwise comparison cannot be reached through a natural generated
  top-N flow.
- Batch publish is not proven live.
- Any claim that v1.4 has shipped trained model improvements is not
  observable through the UI or committed demo artifacts.

This matters because v1.4 is marketed as a deep-dive into Indian music
quality. If users see the current live state, they experience v1.3
surfaces plus empty Discover, not the v1.4 promise.

## 10. Suggested recovery plan

### Day 0: stabilize main

- Fix CI contracts or remove stale contract job.
- Fix `style-presets` typecheck.
- Fix `insert_track` conflict target for `0041`.
- Re-run GitHub CI to green.

### Day 1: prove product surfaces

- Deploy fixed main.
- Seed Discover with `--apply` and commit/apportion a manifest showing
  `apply: true`, row IDs/public IDs, and audio object keys.
- Run `prod-smoke.mjs` and commit its `SUMMARY.md`.
- Run the seven Sprint 17 Playwright specs against production or a
  seeded staging project.

### Day 2-4: make RLHF honest

- Implement worker top-N or demote the feature.
- If implementing, add one integration test that starts from a
  `QueueMessage(top_n_candidates=4)` and verifies four track rows plus
  one `is_current=true`.
- Train on real preference data only after real pairs exist.

### Week 1: model artifact audit

- Create a `model-artifacts.lock.json` with every adapter/checkpoint,
  checksum, HF repo/path, training command, dataset manifest hash, and
  sample WAV hash.
- Replace placeholder benchmark docs with real listening artifacts or
  label them as dry-run CI only.

### Week 2: release v1.4.1

- Treat the current state as v1.4 scaffold.
- Ship v1.4.1 only when:
  - CI is green
  - production smoke is green
  - Discover has real demo audio
  - at least one new backend/adaptor is loaded in production and
    observable
  - RLHF status is accurately documented

## Final answer to the user's core questions

### Did the 17 sprint cycle achieve its objectives?

Partially for UI/schema/scaffolding. No for the full plan. The plan's
high-value objectives were real trained adapters, MOS uplift, live
Discover demos, top-N reranking, and green merge/deploy gates. Those are
not proven and in several cases are contradicted by code or live tests.

### Were they all stub runs, generated but not wired?

Not all. Some application surfaces and schemas are real. But many model
and tuning objectives are dry-run or placeholder:

- HeartMuLa LoRA real trainer: not implemented.
- MusicGen LoRA real trainer: not implemented.
- Stable Audio stems training: not implemented.
- NeMo dry-run: placeholder `.nemo` files.
- Chant LoRA dry-run: empty `.safetensors`.
- Reranker training: dry-run deterministic head; real MERT path missing.
- Top-N candidate generation: schema exists; production worker not wired.

### What was the role of RLAIF/RLHF, and did it succeed?

Its actual role in this merge is preference collection plus offline
reranker scaffolding. It did not succeed as production tuning because
the worker does not generate candidate sets or invoke the reranker, the
real MERT training module is absent, and no live preference-trained
artifact is evidenced.

### Did real LoRA tuning happen?

Not based on committed, reproducible evidence. The repository mostly
contains dry-run validators, placeholder artifact writers, adapter
loading/routing scaffolds, and operator-only `NotImplementedError`
training paths. If real tuning happened off-repo, it needs artifact
hashes, training logs, sample WAVs, and deployment health evidence
before it should count as shipped.

---

## Closeout addendum (2026-05-17, branch `closeout/v1.4-gate-closure`)

This addendum tracks the work done in response to this review on the
`closeout/v1.4-gate-closure` branch (cut off `main@f7b3a13`). Each
entry is "what the audit found" -> "what was changed and verified".

### Stop-the-bleed (P0)

1. **CI contracts job was missing the schema files.**
   `docs/contracts/queue-message.schema.json`, `openapi-cloud.yaml`,
   and `openapi-dgx.yaml` were restored and updated for v1.4. They
   now include `top_n_candidates`, `candidate_index`/`seed`,
   `voice_id` at section level, the widened style/language enums,
   `POST /api/songs/{id}/preferences`, and
   `POST /api/songs/publish-batch`. Validated locally with
   `jsonschema.Draft202012Validator` and `openapi-spec-validator`.

2. **TypeScript voice_id-on-section type error.**
   `packages/song-doc/src/index.ts` was extended to put `voice_id`
   (and a new `language` field) on `SectionSchema`, then
   `pnpm --filter @neo-fm/song-doc export-schema` was re-run and
   `_generated.py` was regenerated via `scripts/song-doc-codegen.py`.
   The TS<->Py parity dump (`pnpm normalize-fixtures` vs
   `uv run python tests/parity_dump.py`) matches byte-for-byte.
   `pnpm -r typecheck` is green locally.

3. **`WorkerDB.insert_track` was incompatible with migration 0041.**
   `services/dgx-worker/app/db.py` now inserts `(job_id, attempt_id,
   candidate_index, is_current)` and conflict-targets
   `(job_id, attempt_id, candidate_index)` to match the unique index
   created by `0041_preference_pairs_and_candidates.sql`. A new
   `set_current_track` helper atomically flips the partial-unique
   `is_current=true` flag for the winning candidate.

4. **prod-smoke accepted `cardCount=0` on Discover.**
   `infra/scripts/prod-smoke.mjs` now fails steps 16/17/18 when the
   Sanskrit / Bengali / Telugu Discover filters return zero public
   cards. The legacy soft-fail behavior is preserved behind an
   explicit `STRICT_V14_DISCOVER=0` env override for pre-seed runs.

### Wire RLHF / top-N for real (P0)

5. **Worker now generates `top_n_candidates` candidates.**
   `services/dgx-worker/app/worker.py` was refactored so a
   `QueueMessage(top_n_candidates=N>1)` does:
   - N deterministic inference calls with seeds derived from
     `(trace_id, candidate_index)`,
   - N mixer passes that share vocal / stems output,
   - N storage uploads under `tracks/<job_id>/<attempt_id>__c<k>.wav`,
   - N `insert_track(..., candidate_index=k, is_current=False)` rows,
   - one `select_best_candidate` call via the deterministic reranker
     (`services/reranker/neofm_reranker.score`), with a fallback path
     that defaults to candidate 0 when scoring fails,
   - one `set_current_track` flip to mark the winner.

   When `top_n_candidates == 1` the legacy single-candidate path is
   preserved bit-for-bit.

6. **Test coverage for top-N.** Added
   `services/dgx-worker/tests/test_worker_top_n.py` (4 cases) that
   verifies seed determinism, N candidate inserts with `is_current`
   flipping to the reranker winner, replay idempotency, and legacy
   N=1 behavior. The full `services/dgx-worker` suite is now
   **89 passed / 1 skipped**.

7. **Metrics + config.** `metrics.reranker_runs_total` is incremented
   on every winner selection; the optional
   `RERANKER_CHECKPOINT_PATH` env is now read by `Settings` (used by
   `select_best_candidate`).

### Honest evidence labelling

8. **Benchmark docs labelled proxy / dry-run.**
   `demos/v1.4/sprint-12-indicf5/benchmark.md` and
   `demos/v1.4/sprint-13-nemo-kannada/benchmark.md` both now have a
   "PROXY / DRY-RUN" banner and rename every column to
   `proxy MOS`. `docs/OPERATOR-HANDOFF.md` was rewritten so the
   per-engine table calls out "plan target" vs "real-run evidence"
   for every Sprint-8-through-14 LoRA / TTS path, and so the
   `+0.288` reranker uplift is labelled as a deterministic proxy
   delta, not a listener-evaluated MOS uplift. The
   `evals/v1.4-bench/README.md` "compare runs" step was reworded the
   same way.

9. **`merge-gate.md` migration table corrected.** The aspirational
   names `0035_voice_catalog.sql` /
   `0036_indic_corpus_audit.sql` / reserved `0038` were replaced
   with the actual filenames in `infra/supabase/migrations/`.

### CI matrix expansion

10. **`.github/workflows/ci.yml` now runs the full Python surface.**
    The `python (uv)` matrix was expanded from three projects to
    nine -- `services/reranker`, `services/lyric-gen`,
    `services/vocal-synth`, `services/stems-synth`,
    `services/cover-art-synth`, and `evals/v1.4-bench` are now
    CI-enforced. Each project's `pyproject.toml` was upgraded with
    realistic mypy overrides for the dynamic-ML / sys-path test
    surfaces, plus ruff per-file-ignores for legitimate IPA / x
    notation in comments and docstrings. New `pyproject.toml` files
    were added for the two services that lacked them
    (`services/reranker`, `evals/v1.4-bench`).

### Local gate (now green on `closeout/v1.4-gate-closure`)

| Surface | Result |
| --- | --- |
| `pnpm -r typecheck` | green |
| `pnpm -r test` (TS + web vitest) | **419 / 419** |
| `jsonschema` queue-message schema | OK |
| `openapi-spec-validator` cloud + dgx | OK |
| `packages/song-doc/python` ruff / mypy / pytest | 10 / 10 |
| `services/music-inference` ruff / mypy / pytest | 90 / 90 |
| `services/dgx-worker` ruff / mypy / pytest | 89 / 90 (1 DGX-only skip) |
| `services/reranker` ruff / mypy / pytest | 23 / 23 |
| `services/lyric-gen` ruff / mypy / pytest | 22 / 22 |
| `services/vocal-synth` ruff / mypy / pytest | 128 / 129 (1 DGX-only skip) |
| `services/stems-synth` ruff / mypy / pytest | 31 / 31 |
| `services/cover-art-synth` ruff / mypy / pytest | 14 / 14 |
| `evals/v1.4-bench` ruff / mypy / pytest | 6 / 6 |
| `song-doc` codegen drift + TS<->Py parity | green |

### What is still not done (carry into v1.5)

These items from sections 4 and 8 of this review remain open after
the closeout, because they require operator-only DGX runs that the
repo cannot perform on its own:

- Real HeartMuLa / MusicGen / Stable Audio / NeMo / chant LoRA
  artifacts. Every committed trainer still raises
  `NotImplementedError` outside `--dry-run`.
- A real MERT-95M `train_apply.py` in `services/reranker`.
- A listener-evaluated MOS panel for any v1.4 backend.
- An `--apply` seed of Discover with real WAV objects in storage
  (the seed manifest still has `"apply": false`).
- Production Vercel deploy + post-deploy `prod-smoke.mjs` run. The
  closeout commit and merge are queued to fire that pipeline; the
  resulting `SUMMARY.md` will land as a follow-up commit per the
  AGENTS.md merge-gate contract.

Until those land, v1.4 should be marketed as "scaffold +
runtime-integration complete" rather than "trained artifact
complete" or "production verified".

