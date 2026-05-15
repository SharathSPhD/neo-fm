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

Worktree: `phase/1-music-inference` (code merged); `phase/1-heartmula-integration` (HeartMuLa loader PR #2 — open).

- [x] Replace placeholder `Dockerfile` with real build: `nvcr.io/nvidia/pytorch:24.08-py3` + `heartmula` lib + FastAPI.
- [x] Add `scripts/download-heartmula.py` (uv-run) that pulls `m-a-p/HeartMuLa-oss-3B` into a mounted `models/` volume.
- [x] Implement eager model load at container boot (TRIZ C2).
- [x] Implement `POST /v1/generate` for one short section (30 s). Returns real WAV bytes via `audio/wav` response.
- [x] Upgrade `/healthz` to report `model_loaded`, `model_version`, `gpu_memory_used_mb` (ADR 0007 fields land in PR #2).
- [x] Local smoke: `docker run --gpus all` + `curl POST /v1/generate` produces a listenable 30 s WAV. *(Captured live on `spark-5208`; runbook in [demos/phase-1-SMOKE-HANDOFF.md](../demos/phase-1-SMOKE-HANDOFF.md).)*
- [x] Commit [demos/phase-1.wav](../demos/phase-1.wav) and an `nvidia-smi` screenshot.
- [x] Gating contract checked: tests green, container starts on DGX, real output, demo artifact committed.

## Phase 2 — Song Document DSL + Western co-composer

Parallel worktrees: `phase/2a-song-doc`, `phase/2b-cocomposer-western` (both merged to main).

- [x] **2a**: harden [packages/song-doc/](../packages/song-doc/) — add Zod refinements (target_duration_seconds ≤ 360, raga only when style in `{carnatic, hindustani}`, etc.). Add codegen script that emits Pydantic v2 models from the Zod-derived JSON Schema (replaces hand-written Python).
- [x] **2a**: golden-file test runner: every fixture in `packages/song-doc/fixtures/` must parse on both TS and Python sides without drift.
- [x] **2b**: implement `WesternCoComposer` in [packages/co-composer/](../packages/co-composer/): chord progressions (I–V–vi–IV etc.), section arrangement, instrumentation hints.
- [x] **2b**: golden `GenerateRequest` for the Western demo committed at [demos/phase-2-request.golden.json](../demos/phase-2-request.golden.json) and pinned byte-for-byte by `phase2.test.ts`. WAV demo captured live on `spark-5208` ([demos/phase-2.wav](../demos/phase-2.wav)); runbook in [demos/phase-2-SMOKE-HANDOFF.md](../demos/phase-2-SMOKE-HANDOFF.md).

## Phase 3 — Public-lyrics provider + Pratyabhijna seam

Worktree: `phase/3-lyrics` (merged to main).

- [x] Seed [data/public-lyrics/](../data/public-lyrics/) with curated public-domain works (Purandaradasa, DVG, Kabir, Tulsidas, Tagore, Blake, Whitman, Sanskrit) — 12 entries gated by `scripts/verify-lyrics-provenance.py` per ADR 0006.
- [x] Implement `PublicLyricsLibraryProvider` in [packages/lyrics/](../packages/lyrics/).
- [x] Keep `PratyabhijnaProvider` as a not-yet-integrated seam (throws `NotYetIntegratedError`). Real impl lands in Phase 10.
- [x] Pipeline returns a Song Document + golden `GenerateRequest` from a verified PD entry. WAV demo (`demos/phase-3.wav`) captured live on `spark-5208`.
- [x] Demo: [demos/phase-3.wav](../demos/phase-3.wav). *(Captured live; runbook in [demos/phase-3-SMOKE-HANDOFF.md](../demos/phase-3-SMOKE-HANDOFF.md).)*

## Phase 4 — Supabase schema + cloud API + dgx-worker

Parallel worktrees: `phase/4a-supabase-schema`, `phase/4b-cloud-api`, `phase/4c-dgx-worker` (all merged to main).

- [x] **4a**: Supabase migrations in [infra/supabase/migrations/](../infra/supabase/migrations/) `0001`–`0011`: `users`, `song_documents`, `jobs`, `tracks`, `subscriptions` tables + RLS + pgmq queue creation + `neo_fm_worker` role + monthly quota + byte caps + realtime publication.
- [x] **4b**: Next.js API routes — `POST /api/songs`, `GET /api/songs`, `GET /api/songs/{id}`, `GET /api/me`. Service-role client server-side only ([apps/web/lib/supabase/server.ts](../apps/web/lib/supabase/server.ts)). Auth via Supabase SSR middleware (no `/api/auth/*` routes — Supabase Auth handles redirects).
- [x] **4c**: Python worker in [services/dgx-worker/](../services/dgx-worker/): pgmq poller → CAS claim → fetch SongDoc → call music-inference → signed PUT to Storage → update job row → ack/archive. Heartbeats lease at 60s (ADR 0008).
- [x] Demo: end-to-end job `ce972419-60fc-40a7-b2d5-10287e465a15` closed the loop in ~39s on live Supabase + DGX (see [docs/OPERATOR-HANDOFF.md](OPERATOR-HANDOFF.md)).

## Phase 5 — Web UI

Worktree: `phase/5-web-ui` (merged to main via PR #3 squashed at SHA `323bc57`).

- [x] Supabase Auth (email) wired into Next.js via [`@supabase/ssr`](https://supabase.com/docs/guides/auth/server-side/nextjs) ([apps/web/app/(auth)/](../apps/web/app/(auth)/) routes + [apps/web/middleware.ts](../apps/web/middleware.ts)). OAuth providers are a config-only addition once enabled in Supabase dashboard.
- [x] Creation canvas: style picker, language picker, duration picker ([apps/web/app/songs/new/creation-canvas.tsx](../apps/web/app/songs/new/creation-canvas.tsx)). Lyric editor + library picker land in Sprint 2 of the [v1-finish plan](../.cursor/plans/) (M2).
- [x] Realtime job status via Supabase Realtime ([apps/web/app/library/song-list.tsx](../apps/web/app/library/song-list.tsx)) — `postgres_changes` on `public.jobs` filtered by `user_id`. Publication added in `0011_realtime_publication.sql`.
- [x] Audio player + library page ([apps/web/app/library/](../apps/web/app/library/)) with signed Storage URLs (1h TTL per ADR 0005). PWA scaffold deferred to Sprint 4 (M-Phase-9) of the v1-finish plan.
- [ ] Demo: [demos/phase-5.gif](../demos/phase-5.gif). *(Captured as part of Sprint 8 final demo reel.)*

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

---

_Last reconciled against repo state at commit `a96c61a` on 2026-05-15. Phases 6-9 and 11 are the active v1-finish backlog driven by `.cursor/plans/neo-fm_v1_finish_*.plan.md`; Phase 10 (Pratyabhijñā) is intentionally out of scope for v1. Phase 12 stays deferred per [SPEC §10](SPEC.md)._
