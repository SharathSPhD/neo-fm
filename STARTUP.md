# neo-fm DGX — Startup Guide

## Overview

neo-fm runs as a fleet of Docker containers on the DGX Spark. The web app lives on Vercel and is always running. This guide covers starting the **DGX side** (inference services + worker).

---

## Prerequisites

- NVIDIA DGX Spark with Docker + NVIDIA Container Toolkit
- GitHub CLI (`gh`) installed and authenticated (for secret resolution)
- HuggingFace Hub access token (for initial model download only)
- Supabase project credentials (service-role key + Postgres DSN)
- Ollama installed with `nemotron-3-super:120b` loaded (if using PWM/lyric-gen)

---

## First-Time Setup

Run the bootstrap script once. It resolves secrets, writes `infra/.env.dgx`, optionally downloads model weights, and starts the stack:

```bash
cd /home/sharaths/projects/neo-fm
bash scripts/dgx-bootstrap.sh
```

### Bootstrap flags

```bash
bash scripts/dgx-bootstrap.sh --skip-models   # Skip HeartMuLa download (if already cached)
bash scripts/dgx-bootstrap.sh --reset         # Wipe and re-enter all secrets
bash scripts/dgx-bootstrap.sh --no-up         # Configure only, don't start containers
```

### What bootstrap does

1. Verifies Docker, `gh` CLI, and optional HuggingFace Hub
2. Reads secrets from env → GitHub Actions secrets → interactive prompt
3. Writes `infra/.env.dgx` (mode 0600, never committed)
4. Downloads HeartMuLa weights to `/mnt/models/heartmula` (skippable)
5. Runs `docker compose up -d`

---

## Subsequent Starts

After first-time setup the `.env.dgx` is already configured. Start/stop the stack directly:

```bash
cd /home/sharaths/projects/neo-fm

# Start all services
docker compose --env-file infra/.env.dgx -f infra/docker-compose.dgx.yml up -d

# Stop all services (frees GPU memory)
docker compose --env-file infra/.env.dgx -f infra/docker-compose.dgx.yml down

# Rebuild and restart after code changes
docker compose --env-file infra/.env.dgx -f infra/docker-compose.dgx.yml up --build -d

# Start with observability stack (Prometheus + Grafana)
docker compose --env-file infra/.env.dgx -f infra/docker-compose.dgx.yml --profile monitoring up -d
```

---

## Startup Order (automatic via healthchecks)

Docker handles dependency ordering automatically. The internal sequence is:

```
music-inference  (starts first; 180s start_period for model cold-start)
      │  healthy?
      ▼
dgx-worker       (starts; polls pgmq for jobs)
      │ spawns sidecar consumer
      ▼
cover-art consumer (goroutine in dgx-worker; polls cover_art_jobs queue)

Parallel (independent from above):
  vocal-synth      (port 8089)
  pwm-api          (port 9000)
  lyric-gen        (port 8090)
  cover-art-synth  (port 8091)
```

---

## Service Reference

| Service | Internal Port | Role | Required? |
|---------|--------------|------|-----------|
| `music-inference` | 8000 | HeartMuLa 3B instrumental generation | **Yes** |
| `dgx-worker` | 9101 (metrics) | Orchestrator: pgmq → inference → vocals → Storage | **Yes** |
| `vocal-synth` | 8089 | Indic singing voice synthesis (5 languages) | Optional |
| `pwm-api` | 9000 | Pratyabhijñā World Model lyric expansion | Optional |
| `lyric-gen` | 8090 | IndicBART fallback for Indic lyrics | Optional |
| `cover-art-synth` | 8091 | Z-Image-Turbo cover art PNG generation | Optional |
| `prometheus` | 9090 | Metrics scraping (monitoring profile) | Optional |
| `grafana` | 3001 | Dashboard (monitoring profile) | Optional |

Optional services: worker skips them gracefully if their URL is not set in `.env.dgx`.

---

## Verify Everything is Running

```bash
# Run the smoke test (health check + one inference round-trip)
bash scripts/dgx-smoke.sh

# Manual health checks per service
curl http://localhost:8000/healthz            # music-inference
curl http://localhost:9000/healthz            # pwm-api
curl http://localhost:8089/healthz            # vocal-synth
curl http://localhost:8090/healthz            # lyric-gen

# Check worker is polling (look for "worker started" log)
docker logs neo-fm-dgx-worker --tail 10

# Check job queue depth
docker logs neo-fm-dgx-worker 2>&1 | grep "queue_lag"
```

---

## Required Secrets (in `infra/.env.dgx`)

### Must be set

| Variable | Source | Purpose |
|----------|--------|---------|
| `MUSIC_INFERENCE_HMAC_SECRET` | GitHub Actions secret (auto-resolved) or generate fresh | HMAC-SHA256 between dgx-worker ↔ music-inference |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API | Storage uploads (never exposed to web client) |
| `PG_DSN` | Supabase → Connection String → Transaction Pooler, user=`neo_fm_worker` | Worker Postgres connection |

### Optional (for sidecars)

| Variable | Purpose |
|----------|---------|
| `VOCAL_SYNTH_HMAC_SECRET` | Enables vocal synthesis |
| `PWM_HMAC_SECRET` | Enables PWM lyric expansion |
| `LYRIC_GEN_HMAC_SECRET` | Enables IndicBART fallback |
| `COVER_ART_SYNTH_HMAC_SECRET` | Enables cover-art generation |
| `HF_TOKEN` | HuggingFace token (model download only) |

### Key tuning defaults (can be overridden)

| Variable | Default | Notes |
|----------|---------|-------|
| `VOCAL_SYNTH_TIMEOUT_SECONDS` | 600 | 300s was too short for 90s carnatic tracks |
| `VISIBILITY_TIMEOUT_SECONDS` | 900 | pgmq lease; heartbeat renews every 60s |
| `MAX_ATTEMPTS` | 3 | DLQ after 3 retries |

---

## Port Reference

| Port | Service | Binding |
|------|---------|---------|
| 8000 | music-inference | loopback only |
| 8089 | vocal-synth | loopback only |
| 8090 | lyric-gen | loopback only |
| 8091 | cover-art-synth | loopback only |
| 9000 | pwm-api | loopback only |
| 9101 | dgx-worker metrics | loopback only |
| 9090 | prometheus | loopback only |
| 3001 | grafana | loopback only |

All ports bind to `127.0.0.1` only. The DGX never accepts inbound connections — it is outbound-only to Supabase.

---

## Checking Logs

```bash
# Worker (most useful for job progress)
docker logs neo-fm-dgx-worker -f

# Music inference (shows generation progress bar)
docker logs neo-fm-music-inference -f

# Vocal synthesis
docker logs neo-fm-vocal-synth -f

# All services at once (requires docker-compose)
docker compose --env-file infra/.env.dgx -f infra/docker-compose.dgx.yml logs -f
```

---

## Database Migrations

Migrations live in `infra/supabase/migrations/` (0001–0050). Apply via the Supabase MCP or CLI:

```bash
# Via Supabase CLI (if configured)
supabase db push

# Via psql (direct)
psql "$PG_DSN" -f infra/supabase/migrations/0050_cover_art_queue_grants.sql
```

The production database is already migrated through `0050`. New migrations must be applied before deploying worker versions that use new schema features.

---

## GPU Governor (ADR 0011)

The governor allows pausing the worker without killing containers (e.g., to run other GPU workloads):

```bash
# Pause worker (stops picking up new jobs; in-flight jobs finish)
python scripts/neo-fm-governor.py pause --tenant "training-run"

# Resume
python scripts/neo-fm-governor.py resume

# Check state
python scripts/neo-fm-governor.py status
```

State file: `/var/run/neo-fm/governor.state` (inside the container volume).

---

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Worker not picking up jobs | pgmq messages VT-leased or jobs in `failed` status | Reset stuck jobs: `update jobs set status='queued' where id=...`; re-enqueue via pgmq.send |
| `permission denied for table tracks` | `neo_fm_worker` role missing UPDATE | `grant update on public.tracks to neo_fm_worker;` |
| All vocal stems fail with empty error | `asyncio.TimeoutError` (synthesis > timeout) | Raise `VOCAL_SYNTH_TIMEOUT_SECONDS` (default now 600) |
| music-inference returns 500 (KV cache assert) | Prompt overflows model context | Transient; worker retries automatically |
| Container healthy but no new jobs | Governor paused | Check `python scripts/neo-fm-governor.py status` |
| `inference_preempted` jobs stuck | CAS blocked retry of `failed` status | Fixed in `claim_job_processing` (CAS now accepts `status in ('queued', 'failed')`) |
