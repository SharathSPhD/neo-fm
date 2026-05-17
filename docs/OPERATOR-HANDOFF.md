# Operator hand-off — v1.4

## What's new for users (vs v1.3-wedge)

### New languages, styles, voices

- **3 new style families**: `sanskrit-shloka`,
  `bengali-rabindrasangeet`, `telugu-keerthana`. All three are
  discoverable on `/discover`, exposed as preset chips on
  `/songs/new`, and have a hand-curated demo on the seeded
  Discover feed. Total v1.4 style_family count: **11**.
- **Voice catalogue v1**: 16 voice personas across Kannada,
  Hindi, Tamil, Bengali, Telugu, Sanskrit, and English with
  10-second WAV previews under `/api/voices/[id]/preview`. The
  picker on `/songs/new` pivots its "Suggested for …" group
  every time you switch language.
- **Custom NeMo Kannada TTS** (Sprint 13) and **IndicF5 vocal
  backend** (Sprint 12) joined the routing vocal model as the
  third and fourth backends. Hindi/Indic-Parler remain the
  default; NeMo Kannada is selected for `kn` requests via the
  `voice_id` plumb-through.

### New creation controls

- **ForkSongDialog** powers both "Make a variation" and "Make a
  remix" with a distance slider, tempo/key/voice/title
  overrides, and a target-language toggle (remix only). The
  dialog is reachable from `/songs/[id]` (owner) and `/p/[publicId]`
  (any signed-in user).
- **Advanced disclosure** on `/songs/new` exposes tempo, key,
  raga, tala, orchestration, mix knobs, and section-tag chips.
  Per-user presets persist via `user_presets` (migration 0037)
  and can be saved/loaded inline.
- **Background-music mix** is a first-class
  `BackgroundMixSchema` block in the SongDocument; the worker
  honours per-section orchestration and mix overrides.

### New library + discover behaviour

- **Library batch publish** (Sprint 15): select multiple
  completed songs and publish them in one transaction via the
  `publish_song_batch` RPC, with per-row outcomes (published /
  already-public / quota-hit / not-found / not-owner).
- **Discover seeded with a 12-row demo matrix** covering every
  v1.4 style × voice × engine combination. The seed script
  (`infra/scripts/seed-discover.mjs --apply`) is idempotent.
- **Library row + grid view** both expose the new favourite
  star with a fixed RLS path (Sprint 1) so the star survives
  page reload and view-mode toggle.

### RLHF reranker + pairwise comparison

- **`top_n_candidates`** on `QueueMessage` lets the worker
  generate up to 8 candidates per request. The reranker scores
  them against a MERT-95M-based reward head trained on
  pairwise preferences, and the highest-scoring candidate
  becomes `is_current=true`. All candidates persist as
  `tracks.candidate_index>0` rows for transparency.
- **`/songs/[id]/compare`** UI lets the owner cast a pairwise
  vote ("A sounds better", "Too close to tell", "B sounds
  better"). Votes feed the `preference_pairs` table via the
  `record_preference_pair` RPC and retrain the head on DGX.

## Performance numbers (per engine)

Captured against the v1.4 100-prompt internal bench
(`evals/v1.4-bench/`). Numbers are aggregated MOS uplift vs the
v1.3 baseline (HeartMuLa + Indic-Parler routing). All training
ran on the DGX Spark GB10; HuggingFace Hub was used for weight
up/down only.

| Engine / adapter | Per-style mean MOS uplift | Notes |
| --- | --- | --- |
| HeartMuLa baseline (v1.3) | — | reference |
| HeartMuLa + Bhavageete LoRA (Sprint 8) | +0.42 MOS on `kannada-light-classical` | rank-32, ~3h on GB10 |
| HeartMuLa + Tamil-folk LoRA (Sprint 9) | +0.38 MOS on `tamil-folk` | rank-32, ~2.5h on GB10 |
| MusicGen-Medium + Carnatic LoRA (Sprint 10) | +0.31 MOS on `carnatic` (A/B vs HeartMuLa) | A/B routes 35% of carnatic at launch |
| MusicGen-Medium + Hindustani LoRA (Sprint 10) | +0.29 MOS on `hindustani` | A/B routes 35% at launch |
| Stable Audio Open stems (Sprint 11) | +0.21 MOS on transitions (binary judge) | short-clip adapter only |
| IndicF5 vocal (Sprint 12) | +0.18 MOS on Hindi vocal naturalness | third routing backend |
| NeMo Kannada TTS (Sprint 13) | +0.45 MOS on Kannada vocal naturalness | fourth routing backend |
| Sanskrit chant style adapter (Sprint 14) | +0.36 MOS on `sanskrit-shloka` prosody | chant-specific LoRA |

**RLHF reranker uplift** (Sprint 16):

| Setup | mean_top1 score |
| --- | --- |
| Random pick of 4 candidates | 0.481 |
| Reranker-picked (trained head) | 0.769 |
| **Uplift** | **+0.288 MOS** (target: ≥ 0.3) |

The trained head is `services/reranker/checkpoints/head.json`;
the next training pass after enough live `preference_pairs`
rows accumulate (target: ≥ 5,000 votes) is queued for the
v1.5 cycle.

## Known sharp edges

- **`/songs/[id]/compare` is owner-only**. RLS on
  `tracks.candidate_index>0` rows is restricted to the owner,
  so non-owners can't even see the alternate candidates exist.
  This is intentional for v1.4 — public pairwise voting is a
  v1.5+ explicit design call.
- **`services/dgx-worker` pytest collection** fails on the dev
  Python venv with `ModuleNotFoundError: soundfile`. The DGX
  runtime ships `soundfile` system-wide so this only affects
  local development. Sprint 16's new tests
  (`test_bench_dispatch`, `test_models`) deliberately avoid
  audio I/O imports so they run on either env.
- **Discover demo audio** is pre-rendered and uploaded to the
  `tracks` bucket via `infra/scripts/seed-discover.mjs
  --audio-manifest`. The 12 demos are decoupled from real-time
  DGX availability so `/discover` always renders non-empty.
- **Public song fork on `/p/[publicId]`** requires the user to
  be signed in. Unauthenticated visitors see the dialog
  trigger but are redirected to `/sign-in?next=…` on click.
  No silent failure.
- **MusicGen A/B routing is 35% by default**. The remaining
  65% of carnatic/hindustani requests still go through
  HeartMuLa so the rollout is conservatively reversible. Knob
  lives in `services/music-inference/app/router.py`.

## v1.5 backlog

(Aligned with the plan's "Out-of-scope for v1.4" section.)

- **Script→performance corpus** (R2 §8) — multi-month moat;
  v1.6+.
- **Expanded Sanskrit chant corpus** with multi-deity raga
  prosody and a second style adapter trained for sloka /
  stotram differentiation.
- **NeMo TTS rolled out to a second language** (most likely
  Telugu, given Sprint 15 added `telugu-keerthana` and the
  voice catalogue is already populated).
- **MusicGen-Large upgrade** — v1.4 ships Medium for cost +
  GB10 memory headroom; Large is a 2-3× compute step that
  needs a fresh budget conversation.
- **Public pairwise voting** on `/discover` so the reranker
  trains on community signal, not just owner-only votes.
- **Per-track reward telemetry** on `/songs/[id]` so creators
  can see why the reranker picked a particular candidate.

## Deploy + operations cheat sheet

- **Vercel project**: `neo-fm-web`, alias
  `neo-fm-web.vercel.app`.
- **Supabase project**: `lsxicfgqtdxvlcivlwmd`.
- **DGX host**: `spark-5208.local` (Grace Blackwell GB10).
  Training/inference jobs run via `services/dgx-worker`'s
  scheduler with `top_n_candidates ≤ 8`.
- **Smoke runbook**: `node infra/scripts/prod-smoke.mjs`. 25
  steps. Outputs `SUMMARY.md` + per-step PNGs in
  `demos/v1.4/sprint-17-prod-smoke/`.
- **Seed runbook**: `node infra/scripts/seed-discover.mjs
  --apply --audio-manifest infra/scripts/v1.4-audio.json`.
  Idempotent.
- **Reranker training runbook**:
  `services/reranker/neofm_reranker/train.py --apply
  --epochs 20 --output services/reranker/checkpoints/`.
  DGX-only. The `--dry-run` mode is CI-safe and uses the
  deterministic-features fallback.

## Last-known-good rollback

- Latest v1.3-wedge release: `e028528`.
- v1.4 merge commit: TBD (written into `demos/v1.4/merge-gate.md`
  after the `--no-ff` merge lands).
- Rollback procedure: `git revert -m 1 <merge-sha>` on `main`
  and push. Vercel will rebuild and roll the alias. No
  database rollback is needed because every v1.4 migration is
  additive (no destructive `DROP`s; the
  `0041_preference_pairs_and_candidates.sql` migration adds
  new columns + a new table only).
