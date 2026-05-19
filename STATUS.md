# neo-fm — Project Status

*Updated: 2026-05-19*

---

## What It Is

**neo-fm** is an India-first, composition-aware AI music generation platform. A Next.js web app on Vercel lets users create full songs; the actual generation runs on an NVIDIA DGX Spark. The DGX is outbound-only — it polls Supabase for jobs and pushes results up; the cloud never initiates inbound connections to the DGX.

### Core pipeline (one job)

```
User clicks "Generate" (web)
      │
      ▼ create_song_job() stored proc
Supabase: jobs row (queued) + pgmq message
      │
      ▼ dgx-worker polls pgmq
music-inference → HeartMuLa 3B → 30s WAV sections (instrumental)
vocal-synth     → Indic TTS × 5 languages (hi, kn, ta, te, bn) → per-language WAV stems
                  (parallel; each lang gets a full vocal render)
Storage upload  → Supabase Storage (tracks bucket)
      │
      ▼ jobs.status = 'completed'
Realtime subscription pushes to web UI → user hears song
```

---

## Current Status (v1.5, 2026-05-19)

### Jobs

| Status | Count |
|--------|-------|
| completed | 26 |
| failed (intentional cancellations) | 5 |
| queued | 0 |
| processing | 0 |

Queue fully drained. All 26 processable seed songs have real audio with 5/5 vocal stems.

### Build

- **Main branch**: 5 commits ahead of last merged PR, CI green
- **Worktree branch** (`claude/silly-cori-0ffadc`): 6 bug-fix commits, PR #16 open
- **Web app**: Auto-deployed to Vercel on every `main` push
- **DB migrations**: 0001–0050 applied to production

---

## Architecture

### Services (DGX)

| Service | Port | Technology | Role |
|---------|------|-----------|------|
| `music-inference` | 8000 | FastAPI + HeartMuLa 3B (PyTorch) | Instrumental generation from song document |
| `dgx-worker` | 9101 (metrics) | Python asyncio, psycopg, httpx | Orchestrator: pgmq poller → inference → vocal → Storage |
| `vocal-synth` | 8089 | FastAPI + kenpath/svara-tts-v1 (Orpheus codec) | Indic singing voice (5 languages per song) |
| `pwm-api` | 9000 | FastAPI + httpx | Thin wrapper calling PWM project for lyric expansion |
| `lyric-gen` | 8090 | FastAPI + IndicBART SFT | Indic lyric fallback when PWM is unavailable |
| `cover-art-synth` | 8091 | FastAPI + Z-Image-Turbo/SDXL-Turbo | PNG cover art generation |
| `stems-synth` | — | ML training stack | Transition stems / beat breaks (optional) |
| `reranker` | — | MERT-95M (PyTorch) | RLHF reward model for song reranking (optional) |

### Cloud (always running)

| Component | Platform | Role |
|-----------|----------|------|
| Web app | Vercel (Next.js 14 App Router) | User-facing UI, auth, realtime playback |
| Database | Supabase Postgres | Jobs, tracks, users, song_documents, social |
| Queue | pgmq (extension on Supabase Postgres) | `song_generation_jobs` + `cover_art_jobs` queues |
| Storage | Supabase Storage | WAV tracks (tracks bucket) + cover art (cover-art bucket) |
| Realtime | Supabase Realtime | Push job status updates to web UI |

### Security model

- **DGX is outbound-only** — no inbound ingress, Tailscale optional
- **HMAC-SHA256** on every service-to-service call (ADR 0003)
- **`neo_fm_worker`** Postgres role: UPDATE jobs, INSERT/UPDATE tracks, full pgmq; no access to users/subscriptions (ADR 0004)
- **RLS**: users see only their own rows (ADR 0005)

---

## Framework: Major Aspects

### Song Document DSL (`packages/song-doc`)

The central data structure. A `SongDocument` describes a song declaratively:

```typescript
{
  style_family: "carnatic" | "hindi-film" | "kannada-light-classical" | ...,
  target_duration_seconds: 60 | 90 | 120,
  raga?: string,
  tala?: string,
  language: "kn" | "hi" | "ta" | "te" | "bn" | "en",
  sections: [
    { type: "verse" | "chorus" | "bridge" | "intro" | "outro", target_seconds: 30, ... }
  ]
}
```

26 style families supported as of v1.5. The DSL is the contract between the web composer UI and the DGX inference pipeline.

### pgmq Queue Architecture (ADR 0001, 0008)

`pgmq` (PostgreSQL message queue extension) drives all async work:

- **`song_generation_jobs`**: one message per song; read by dgx-worker
- **`cover_art_jobs`**: one message per cover-art request; consumed by cover-art consumer goroutine in the same worker process
- **`email_notification_queue`**: transactional email (v1.5)

Visibility timeout + heartbeat renewal ensures at-most-once delivery with stale-lease takeover for dead workers (ADR 0008). The `claim_job_processing` CAS prevents concurrent processing of the same job.

### Vocal Synthesis Pipeline

Five parallel Indic language renders per song:
- **Hindi (hi)**: kenpath/svara-tts-v1 (Orpheus codec, `<|audio|>` trigger format)
- **Kannada (kn)**: svara-tts-v1
- **Tamil (ta)**: svara-tts-v1
- **Telugu (te)**: svara-tts-v1
- **Bengali (bn)**: svara-tts-v1

Fallbacks: ai4bharat/indic-parler-tts → IndicF5 → NeMo. If all fail for a language, job still completes with remaining stems (non-fatal). If a language takes > 600s, it times out individually but others succeed.

### PWM Integration (v1.5 Sprint 1)

The `pwm-api` sidecar bridges neo-fm's `style_family` vocabulary to PWM's creative-domain vocabulary. For each job:

1. Worker calls `/v1/generate-lyric` with song document context
2. PWM returns expanded lyric structure (stanzas, phrasing, metre)
3. Worker uses this as the lyric template for vocal synthesis

PWM is optional: if `PWM_API_URL` is unset the worker uses the raw song document lyrics.

### RLHF Reranker (v1.4 Sprint 16)

For `top_n_candidates > 1` jobs:
- Worker generates N candidate renders
- MERT-95M reward model scores each candidate
- Highest-scoring candidate is set as `is_current=true` in `tracks`
- Preference pairs are logged for future reranker training

Currently deployed with `top_n_candidates=1` (single candidate, no reranking) for all production jobs.

### Observability

- **Prometheus** metrics from dgx-worker (9101), pwm-api (9000), lyric-gen, cover-art-synth, music-inference
- **Grafana** dashboard at localhost:3001 (monitoring profile)
- **Structured JSON logs** across all services (ADR 0007)
- **Queue lag metric** (`neofm_queue_lag_seconds`) shown on main dashboard

---

## Database Migrations (0001–0050)

50 migrations covering:
- **0001–0011**: Core schema (jobs, tracks, RLS, worker role, pgmq queues) — Phase 4 baseline
- **0012–0023**: Phase 5 extensions (realtime, public share, social, billing seam)
- **0024–0036**: v1.4 (stems, cover-art, RLHF preference pairs, developer tier)
- **0037–0050**: v1.5 (email queue, voice samples, cover-art grants, seed data fixes)

Notable migrations:
- `0006`: `neo_fm_worker` Postgres role definition
- `0041`: RLHF preference pairs + multi-candidate tracks schema
- `0043`: `email_notification_queue` pgmq setup
- `0050`: `grant update on public.tracks to neo_fm_worker` (cover-art + re-delivery fix)

---

## Phases Completed

| Phase | Description | Outcome |
|-------|-------------|---------|
| **0** | DGX bootstrap, repo scaffold, prerequisites | Bootstrap script + env template |
| **1** | music-inference vertical slice (HeartMuLa 3B on GPU) | Real 30s WAV, demos/phase-1.wav |
| **2** | Song Document DSL + Western co-composer | Structured song with chord progressions |
| **3** | Public-lyrics provider + Pratyabhijñā seam | 12-entry PD corpus (Purandaradasa, Tagore…) |
| **4** | Supabase schema + cloud API + dgx-worker (end-to-end live) | Real job turnaround ~39s on prod |
| **5** | Web UI (Next.js App Router, auth, realtime, PWA) | Auto-deployed to Vercel |

**v1.3**: Cover-art sidecar (Z-Image-Turbo)
**v1.4**: Stems, RLHF reranker, billing, developer tiers
**v1.5**: PWM lyric expansion, IndicBART fallback, email notifications, full vocal pipeline

---

## Pending Actions

### Immediate (open PR #16)

| Item | File | Notes |
|------|------|-------|
| Merge PR #16 | `claude/silly-cori-0ffadc` | 6 bug-fix commits: CAS fix, JSON logging, timeout fix |

### Bug fixes in PR #16 (not yet on main)

1. `claim_job_processing` CAS accepts `status in ('queued', 'failed')` — `inference_preempted` jobs no longer orphaned
2. `_JsonFormatter` with explicit `_STDLIB_ATTRS` — `extra={}` fields appear in structured logs
3. `VOCAL_SYNTH_TIMEOUT_SECONDS` default 300→600 — 90s tracks no longer drop all vocals silently
4. `vocal_lang_failed` err includes `type(exc).__name__` — timeouts distinguishable from HTTP errors

### Active Backlog

| Priority | Item | Notes |
|----------|------|-------|
| High | **Phase 6–7**: Carnatic/Hindustani/Kannada-folk music modules | True raga structure, not just style_family tagging |
| High | **Phase 8**: GPU governor hardening (ADR 0011) | State file coordination for DGX multi-tenant use |
| Medium | **Email notifications**: transactional email on job completion | Queue exists (0043); sender/template not wired |
| Medium | **Developer tier rate limiting**: tier-based quota enforcement | DB functions exist (0045–0046); enforcement not in worker |
| Medium | **Observability**: Grafana alert thresholds, queue lag alerts | Dashboard exists; alerts.yaml needs tuning |
| Low | **PWA polish**: offline mode, push notifications | Phase 9; Supabase quotas live; push not implemented |
| Low | **Voice preview rendering**: `scripts/render_voice_previews.py` stub | 5–10 line implementation needed |
| Low | **CORS tightening in PWM API** | Restrict to `neo-fm.vercel.app` |
| Research | **PWM H5b ablation root cause** | English-domain WM conditioning may be net-negative |

### Known Technical Debt

| Area | Issue |
|------|-------|
| PWM checkpoint paths | Hardcoded in `engine.py` lines 43–49; no env-var override |
| PWM job state | In-memory only; disappears on API restart |
| Cover-art DLQ | DLQ queue `cover_art_jobs_dlq` exists in config but not yet created in DB |
| `_pending` Pyright warning | `asyncio.wait()` unused second return in `worker.py:534` — cosmetic, no functional impact |
| Reranker in prod | Deployed with `top_n_candidates=1`; reranker path untested on live traffic |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web app | Next.js 14 (App Router), TypeScript, Tailwind, pnpm |
| Cloud DB + queue | Supabase Postgres + pgmq + Realtime + Storage |
| Services | Python 3.10–3.12, FastAPI, Uvicorn, psycopg 3 |
| Package manager | `uv` (Python), `pnpm` (TypeScript) |
| ML models | HeartMuLa 3B (music), kenpath/svara-tts-v1 (vocals), Z-Image-Turbo (cover art), MERT-95M (reranker) |
| Containerisation | Docker Compose (DGX), `nvcr.io/nvidia/pytorch:25.11-py3` base |
| CI/CD | GitHub Actions (lint, type-check, docker-build); Vercel (web auto-deploy) |
| Observability | Prometheus + Grafana (monitoring profile) |

---

## Repository Layout (key paths)

```
neo-fm/
├── infra/
│   ├── docker-compose.dgx.yml       # Full DGX service stack
│   ├── .env.dgx.example             # Secrets template
│   └── supabase/migrations/         # 50 SQL migrations
├── services/
│   ├── music-inference/             # HeartMuLa inference
│   ├── dgx-worker/                  # Orchestrator + job lifecycle
│   ├── vocal-synth/                 # Indic TTS (Orpheus codec)
│   ├── pwm-api/                     # PWM lyric expansion wrapper
│   ├── lyric-gen/                   # IndicBART fallback
│   ├── cover-art-synth/             # Z-Image-Turbo cover art
│   ├── stems-synth/                 # Transition stems
│   └── reranker/                    # MERT-95M reward model
├── apps/web/                        # Next.js web app (Vercel)
├── packages/
│   ├── song-doc/                    # Song Document DSL (Zod + TS)
│   ├── co-composer/                 # Western co-composer
│   └── lyrics/                      # Lyrics providers
├── scripts/
│   ├── dgx-bootstrap.sh             # One-command DGX setup
│   ├── dgx-smoke.sh                 # Health check + smoke test
│   └── neo-fm-governor.py           # GPU governor CLI
└── docs/
    ├── SPEC.md                      # Technical specification
    ├── PRD.md                       # Product requirements
    ├── DECISIONS/                   # 36+ ADRs
    └── OPERATOR-HANDOFF.md          # DGX runbook
```
