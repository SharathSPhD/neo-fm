# neo-fm — Implementation Plan

This is the in-repo, durable expansion of the orchestration plan (which lives in Cursor). It is updated whenever the orchestration plan is. Read alongside [SPEC.md](SPEC.md) and [PRD.md](PRD.md).

## Phase 0 — Bootstrap on DGX

- [x] Confirm DGX runtime: `nvidia-smi`, `docker --version`, `tailscale status` captured as [demos/phase-0-dgx.txt](../demos/phase-0-dgx.txt).
- [x] Create public repo `SharathSPhD/neo-fm`.
- [x] Scaffold pnpm + Turborepo monorepo per [SPEC.md](SPEC.md) §2.
- [x] Configure git identity (`SharathSPhD`, empty email).
- [x] CI stub: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) + [`.github/workflows/docker-build.yml`](../.github/workflows/docker-build.yml).
- [x] Write [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md), [CONTRIBUTING.md](../CONTRIBUTING.md).
- [x] Write [SPEC.md](SPEC.md), [PRD.md](PRD.md), this plan.
- [x] Decide pg-boss vs pgmq → [DECISIONS/0001-queue.md](DECISIONS/0001-queue.md): **pgmq**.
- [x] First push to `main` with `demos/phase-0-NOTE.md` placeholder for the repo screenshot.

## Phase 1 — Real music-inference container (vertical slice)

Worktree: `phase/1-music-inference`.

- [ ] Replace placeholder `Dockerfile` with real build: `nvcr.io/nvidia/pytorch:24.08-py3` + `heartmula` lib + FastAPI.
- [ ] Add `scripts/download_weights.py` (uv-run) that pulls `m-a-p/HeartMuLa-oss-3B` into a mounted `models/` volume.
- [ ] Implement eager model load at container boot (TRIZ C2).
- [ ] Implement `POST /v1/generate` for one short section (30 s). Returns real WAV at `/mnt/audio/jobs/<job_id>/<section_id>.wav`.
- [ ] Upgrade `/healthz` to report `model_loaded`, `model_version`, `gpu_memory_used`.
- [ ] Local smoke: `docker run --gpus all` + `curl POST /v1/generate` produces a listenable 30 s WAV.
- [ ] Commit [demos/phase-1.wav](../demos/phase-1.wav) and an `nvidia-smi` screenshot.
- [ ] Gating contract checked: tests green, container starts on DGX, real output, demo artifact committed.

## Phase 2 — Song Document DSL + Western co-composer

Parallel worktrees: `phase/2a-song-doc`, `phase/2b-cocomposer-western`.

- [ ] **2a**: harden [packages/song-doc/](../packages/song-doc/) — add Zod refinements (target_duration_seconds ≤ 360, raga only when style in `{carnatic, hindustani}`, etc.). Add codegen script that emits Pydantic v2 models from the Zod-derived JSON Schema (replaces hand-written Python).
- [ ] **2a**: golden-file test runner: every fixture in `packages/song-doc/fixtures/` must parse on both TS and Python sides without drift.
- [ ] **2b**: implement `WesternCoComposer` in [packages/co-composer/](../packages/co-composer/): chord progressions (I–V–vi–IV etc.), section arrangement, instrumentation hints.
- [ ] **2b**: golden test renders a Western Song Document → HeartMuLa prompt-set → calls Phase 1 container → produces [demos/phase-2.wav](../demos/phase-2.wav).

## Phase 3 — Public-lyrics provider + Pratyabhijna seam

Worktree: `phase/3-lyrics`.

- [ ] Seed [data/public-lyrics/](../data/public-lyrics/) with curated public-domain works (Purandaradasa, DVG, Kabir, Tulsidas, Tagore, Blake, Whitman, Sanskrit).
- [ ] Implement `PublicLyricsLibraryProvider` in [packages/lyrics/](../packages/lyrics/).
- [ ] Keep `PratyabhijnaProvider` as a not-yet-integrated seam (throws `NotYetIntegratedError`). Real impl lands in Phase 10.
- [ ] Endpoint returns a Song Document with library lyrics + generates a real WAV.
- [ ] Demo: [demos/phase-3.wav](../demos/phase-3.wav).

## Phase 4 — Supabase schema + cloud API + dgx-worker

Parallel worktrees: `phase/4a-supabase-schema`, `phase/4b-cloud-api`, `phase/4c-dgx-worker`.

**Operator action required before this phase starts.** Every step below
depends on a real Supabase project, a real Vercel link, and real
credentials. See [`PHASE-4-HANDOFF.md`](PHASE-4-HANDOFF.md) for the
checklist — the agent will refuse to fake any of it.

- [ ] **4a**: Supabase migrations in [infra/supabase/migrations/](../infra/supabase/migrations/): `users`, `song_documents`, `jobs`, `tracks`, `subscriptions` tables + RLS + pgmq queue creation.
- [ ] **4b**: Next.js API routes — `POST /api/songs`, `GET /api/songs`, `GET /api/songs/{id}`, `GET /api/me`. Supabase service-role server-side only.
- [ ] **4c**: Python worker in [services/dgx-worker/](../services/dgx-worker/): pgmq poller → fetch SongDoc → call music-inference → signed PUT to Storage → update job row.
- [ ] Demo: end-to-end `curl POST /api/songs` → ready signed URL in Supabase Storage.

## Phase 5 — Web UI

Worktree: `phase/5-web-ui`.

- [ ] Supabase Auth (email + OAuth) wired into Next.js.
- [ ] Creation canvas: style picker, language picker, duration picker, lyrics-or-prompt input.
- [ ] Realtime job status via Supabase Realtime.
- [ ] Audio player + library page + PWA scaffold.
- [ ] Demo: [demos/phase-5.gif](../demos/phase-5.gif) of full UX.

## Phase 6 — Carnatic + Hindustani + Kannada-folk modules

Parallel worktrees: `phase/6a-carnatic`, `phase/6b-hindustani`, `phase/6c-kannada-folk`.

- [ ] **6a**: Carnatic module — raga rules (Kalyani, Bhairavi, Mohanam etc.), tala (Adi, Rupakam), instrumentation (mridangam, tanpura, violin), HeartMuLa tag mapping.
- [ ] **6b**: Hindustani module — raga rules (Yaman, Bhairavi, Bhairav etc.), tala (Teentaal, Ektaal, Jhaptal), instrumentation (harmonium, tabla, tanpura).
- [ ] **6c**: Kannada-folk module — Janapada, Bhavageethe rhythm and refrain patterns; instrumentation (dhol, flute, percussion).
- [ ] Demo: one 90 s WAV per style.

## Phase 7 — Indic phonetics + svara-TTS vocal layer

Parallel worktrees: `phase/7a-g2p`, `phase/7b-vocal-synth`.

- [ ] **7a**: integrate AI4Bharat Indic-TTS + IITM Common Label Set into Song Document `phonemes` field per section.
- [ ] **7b**: stand up [services/vocal-synth/](../services/vocal-synth/) with svara-TTS in its own Docker container. Mixer overlays Indic vocals onto HeartMuLa instrumental.
- [ ] Demo: A/B WAVs (HeartMuLa-only vs HeartMuLa + svara-TTS) for the same Kannada/Hindi line.

## Phase 8 — GPU-share governor

Worktree: `phase/8-governor`.

- [ ] `nvidia-smi`-aware throttling in `dgx-worker`. Music capped ≤ 50% GPU util.
- [ ] Priority queue: LLM fine-tune jobs preempt music.
- [ ] Demo: synthetic load test transcript showing worker yielding.

## Phase 9 — PWA polish, notifications, quotas

Worktree: `phase/9-pwa-quotas`.

- [ ] PWA installable on mobile + desktop.
- [ ] Email notifications via Supabase Edge Functions + Resend.
- [ ] Per-tier quotas enforced at `POST /api/songs` with 429 + remaining-count.
- [ ] Demo: PWA install screenshot + quota enforcement test.

## Phase 10 — Pratyabhijna integration

Worktree: `phase/10-pratyabhijna`.

- [ ] Real `PratyabhijnaProvider` adapter: prompt + language + style → Song Document.
- [ ] Default lyrics source on `POST /api/songs` when caller supplies `prompt`.
- [ ] Demo: `curl POST /api/songs` with `{"prompt": "monsoon evening in Mysore", "language": "kn", "style": "kannada-folk"}` returns a Kannada Song Document + 90 s WAV.

## Phase 11 — Observability

Worktree: `phase/11-observability`.

- [ ] Prometheus exporters in `music-inference`, `dgx-worker`, `vocal-synth`.
- [ ] Grafana dashboard JSON in [infra/grafana/](../infra/grafana/).
- [ ] Alert rules: GPU util > threshold, job-lag > 60 s, HeartMuLa error rate > 1% / 5 min.
- [ ] `/healthz` reports model version + GPU memory + queue lag.
- [ ] Demo: [demos/phase-11-grafana.png](../demos/phase-11-grafana.png) + alert-fired screenshot.

## Phase 12 — Managed-API pro tier (deferred, post-v1)

Worktree: `phase/12-managed-fallback`.

- [ ] `MusicEngine` adapter abstraction with `HeartMuLaEngine` (default) and `LyriaProEngine` (pro tier only).
- [ ] Routing rule: `tier=pro` users may opt into Lyria for styles where HeartMuLa lags.
- [ ] No-op on free tier; do not block v1 launch.
- [ ] Demo: A/B WAV comparison on the same Song Document.
