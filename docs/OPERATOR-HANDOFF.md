# neo-fm v1 / v1.1 — release notes & operator handoff

Status as of v1.1 deep-dive close-out (Sprint J). Originally written
at v1 (Sprint 8); the v1.1 deep-dive added 10 sprints of hardening
(reviews, app shell, auth callback, orphan recovery, song titles,
TTS overhaul, pricing/account/help, library upgrades, discover +
profiles + social, "wow" features, security advisors + HTTP
hardening, and this doc rewrite). Every item below is shipped, not
planned.

If you're picking up the project, read this top-to-bottom and
follow the link to the appropriate doc rather than expecting the
full content to live inline here. v1.1 split the operator content
across five canonical docs:

- [ARCHITECTURE.md](ARCHITECTURE.md) — what runs where, who talks
  to whom.
- [REPRODUCIBILITY.md](REPRODUCIBILITY.md) — zero-to-running in
  local / DGX / prod.
- [PRODUCTION-MIGRATION.md](PRODUCTION-MIGRATION.md) — the path
  from "single DGX + Supabase managed" to AWS, with cost tables.
- [SECURITY.md](SECURITY.md) — trust boundaries, secrets, RLS
  map, advisor sweeps.
- [RUNBOOK.md](RUNBOOK.md) — daily ops, alert playbooks, recovery.

This file remains the historical release-notes surface; jump into
the *Reproducing this state* section below for the v1-era steps,
or into REPRODUCIBILITY.md for the current canonical steps.

## 1. What v1 is

**neo-fm v1** is an India-first, composition-aware AI music platform.
A user signs up, picks a style template (Carnatic kriti, Hindustani
khayal sketch, Kannada bhavageete, Kabir doha, Tagore song, Bollywood
ballad, Tamil folk, Western pop), edits the verse in their script of
choice, and gets back a 48 kHz stereo WAV with mixed instrumental +
Indic vocals — typically inside a minute. They can:

- play the song back in their library,
- regenerate any individual section,
- publish to a public `/s/[publicId]` URL with OG cards and a
  copy-paste embed iframe,
- install the marketing surface as a PWA,
- receive an email when a job finishes.

Generation is fanned out across a HeartMuLa-OSS-3B instrumental model
and a `kenpath/svara-tts-v1`-based vocal synth sidecar, both running
on a single DGX Spark (GB10) box reachable from Vercel via the
Supabase data plane. A cooperative GPU governor lets operators drain
the worker without ever ack-ing a job that didn't actually finish.
Prometheus + Grafana scrape the lot.

## 2. What shipped (sprint-by-sprint)

Each sprint merged to `main` behind a green CI gate. Headline
deliverables:

| Sprint | Theme                     | Headline deliverables                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | Truth-up                  | Plan checkboxes reconciled with actual state; FakeMusicModel prod-guard added; OpenAPI `GenerateRequest` aligned with `serve.py`; worker README brought current.                                                                                                                                                                                                                                                                       |
| 1      | Indian co-composers + M3  | `CarnaticCoComposer`, `HindustaniCoComposer`, `KannadaFolkCoComposer` in `packages/co-composer` with raga/tala/instrumentation rules; wired into `POST /api/songs`. Eight style presets in `packages/style-presets` + a preset gallery in the creation canvas (M3).                                                                                                                                                                    |
| 2      | M2, M4, M5                | Per-section lyric editor with script picker (Devanagari/Kannada/Tamil/Telugu/Bengali/Latin) + length caps + library picker (M2). `/songs/[id]` detail page rendering the Song Document with signed-URL on-error refetch (M4, [ADR 0012][ADR12]). Section-level regenerate endpoint + UI + migration `0012_section_regen.sql` (M5).                                                                                                       |
| 3      | M1 public share surface   | `/s/[publicId]` public page, dynamic OG image, embed iframe, share modal, migration `0013_public_songs.sql` ([ADR 0013][ADR13]).                                                                                                                                                                                                                                                                                                       |
| 4      | Hardening & PWA           | PWA manifest + service worker + offline library shell. Supabase Edge Function `notify-job-complete` sending native email on completion. Per-IP rate limiting in `middleware.ts` (in-memory fallback + Upstash if configured). Quota counts completed jobs only + concurrent processing cap (`0014_quota_completed_only.sql`, [ADR 0014][ADR14]). Lyric length caps (1000/section, 4000 total) + blocklist in `packages/song-doc`. Library subscribes to `tracks INSERT` and refetches signed URL on completion. |
| 5      | Vocal synth + mixer       | `services/vocal-synth` real implementation against `kenpath/svara-tts-v1`, HMAC auth, `/v1/vocalize`. `services/dgx-worker/app/mixer.py` performs time-align + duck-compress + stereo 48 kHz mixdown. Worker fans out to vocal-synth in parallel for `hi/kn/ta/te/bn`, soft-fails per-language ([ADR 0015][ADR15]).                                                                                                                       |
| 6      | GPU governor              | `services/dgx-worker/app/governor.py` reading shared state file; worker integration with `inference_preempted` taxonomy + `SIGTERM` handler. `scripts/neo-fm-governor.py` operator CLI (`pause`, `resume`, `status`, `drain`). Three ADR 0011 §6 test gates (`drain-respects-in-flight`, `drain-deadline-SIGTERM`, `preempted-taxonomy`) all green ([ADR 0011][ADR11], [ADR 0016][ADR16]).                                                |
| 7      | Observability             | `/metrics` Prometheus endpoints in `music-inference`, `vocal-synth`, and `dgx-worker` (embedded HTTP server in the worker). `/healthz` everywhere reports `queue_lag_seconds` + `jobs_in_flight`. `infra/grafana/neo-fm-overview.json` dashboard + `infra/grafana/alerts.yaml` rules. `docker-compose.dgx.yml` ships a `monitoring` profile with Prometheus + Grafana ([ADR 0017][ADR17]).                                                |
| 8      | Landing + handoff         | Real India-first landing page (`apps/web/app/page.tsx`) with hero, value props, style gallery sourced from `@neo-fm/style-presets`, how-it-works, sign-up CTA, WCAG AA contrast on the dark palette. This release-notes rewrite.                                                                                                                                                                                                       |

### v1.1 deep-dive (Sprints A-J)

| Sprint | Theme | Headline deliverables |
| --- | --- | --- |
| A | Reviews | Six rigorous review docs under `docs/REVIEWS/`: architecture, security, ux, info-architecture, wow-factors, tts. |
| B | App shell | Persistent auth-aware nav (top + mobile bottom + hamburger), user menu, theme toggle, loading/error boundaries, empty states, breadcrumbs. ADR 0019. |
| C (a) | Auth callback | `/auth/callback` route exchanges code-from-email link for a session and redirects into the app; works around Vercel deployment protection. |
| C (b) | Orphan recovery | `recover_song_job` RPC + `POST /api/songs/[id]/recover` + UI Recover button + `orphan-reconciler` edge function + migration `0016_recover_song_job`. Worker performs transactional audit on every ack. |
| C (c) | Song titles | `title` field promoted on `SongDocumentSchema`; rendered in library, song detail, share, OG, embed. Preset titles populated. |
| D | TTS overhaul | `preprocess.py` (NFC + ZWJ/ZWNJ + halant + IPA + prosody), `ParlerTTSModel`, `RoutingVocalModel` (svara -> parler -> fake), `vocal-eval.py` (librosa-based scoring). Migration `0018_vocal_telemetry` and ADR 0020. |
| E | Pricing / account / help | `/pricing` (waitlist CTAs, no Stripe), `/account` (export + delete + plan badge), `/help` FAQ, `/feedback` form -> `public.feedback` (migration `0021_feedback`). |
| F | Library upgrades | Search, filter, sort, pagination, rename, delete, favorite, onboarding modal. Migration `0022_library_upgrades`. |
| G | Discover + profiles + social | `/discover` feed, `/u/[handle]` public profiles, `/onboarding/handle`, likes / follows / reports. Migrations `0023_user_handles`, `0024_social`. |
| H | Wow features | Live spectrogram on every audio player; stem downloads (migration `0025_stems`); AI cover art via Hugging Face Inference (migration `0026_cover_art`); "Make a variation" button; lyrical karaoke ticker synced to audio.currentTime. |
| I | Hardening | Migration `0027_security_advisors`: SECURITY DEFINER views -> INVOKER, tightened `song_reports` RLS, advisor-clean grants. ADR 0021. HTTP hardening: CSP + HSTS + permissions-policy + per-route rate limits + `/api/health` endpoint. |
| J | Docs | This rewrite. New canonical docs: `docs/ARCHITECTURE.md`, `docs/REPRODUCIBILITY.md`, `docs/PRODUCTION-MIGRATION.md`, `docs/SECURITY.md`, `docs/RUNBOOK.md`. |

[ADR11]: DECISIONS/0011-governor-and-leases.md
[ADR12]: DECISIONS/0012-signed-url-playback.md
[ADR13]: DECISIONS/0013-public-share-surface.md
[ADR14]: DECISIONS/0014-quota-counts-completed.md
[ADR15]: DECISIONS/0015-vocal-synth-and-mixer.md
[ADR16]: DECISIONS/0016-governor-implementation.md
[ADR17]: DECISIONS/0017-observability-stack.md
[ADR19]: DECISIONS/0019-app-shell-and-auth-lifecycle.md
[ADR20]: DECISIONS/0020-vocal-synth-multi-backend-and-eval.md
[ADR21]: DECISIONS/0021-security-definer-review.md

## 3. End-to-end pipeline state

`landing → /sign-up → /songs/new (preset → edit → submit) → POST
/api/songs → create_song_job → pgmq → dgx-worker → music-inference
(+ parallel vocal-synth fan-out) → mixer → Supabase Storage → tracks
row → completed → email + realtime library push → /songs/[id] (with
section-regen) → publish → /s/[publicId] (OG + embed)` is the user
journey and **all** of it runs through real Supabase, real HeartMuLa
weights, and real vocal weights when the `vocal` compose profile is
on.

A representative full-fat trace from the most recent end-to-end run:

| Step                                                          | Result                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /api/songs` (preset = `carnatic-kriti`)                  | `201`, Song Document validated, `create_song_job` returns `{job_id, song_id, status: queued}`            |
| `dgx-worker` claim CAS                                         | `attempts → 1`, `status → processing`, lease heartbeat tracked                                          |
| `POST music-inference /v1/generate`                            | `200 audio/wav`, HMAC verified, instrumental stem rendered                                              |
| `POST vocal-synth /v1/vocalize` × N languages (parallel)        | `200 audio/wav` per language, HMAC verified                                                             |
| Worker `mixer.py`                                              | Time-aligned, side-chain ducked, compressed, stereo 48 kHz mixdown                                      |
| `POST storage/v1/object/tracks/<job>/<attempt>.wav`            | `200` upload                                                                                            |
| `insert into public.tracks`                                    | `bytes`, `format=wav`, `duration_seconds` set                                                           |
| Final job row                                                  | `status=completed`, `attempts=1`, `finished_at` set, signed URL fetches the WAV                         |
| `notify-job-complete` edge function                            | Sent native Supabase email to the song owner                                                            |
| Library `postgres_changes` channel                             | Pushed the new track to the open library tab without a refresh                                          |
| `POST /api/songs/[id]/publish`                                 | Returned `{public_id, share_url, embed_url, og_image_url}`                                              |

## 4. What is live on `spark-5208`

| Component                                | State                                                                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| HeartMuLa-OSS-3B weights                  | `/home/sharaths/models/heartmula` (21 GB) via `scripts/download-heartmula.py`                                                                         |
| `kenpath/svara-tts-v1` vocal weights      | `/var/cache/huggingface` (mounted read-only into `vocal-synth`)                                                                                       |
| `music-inference` container               | Image `neo-fm/music-inference:phase1` (20.9 GB). `/healthz`: `model_loaded=true`, exposes `/metrics`                                                  |
| `vocal-synth` container                   | Image `neo-fm/vocal-synth:dgx`. Healthy, HMAC-protected, exposes `/metrics`. Toggled by the `vocal` compose profile                                  |
| `dgx-worker` container                    | Running, polling pgmq via the Supabase transaction pooler. Embedded `/metrics` HTTP server on port `9101`. Honors `GOVERNOR_STATE_PATH`               |
| Governor state file                       | `/var/run/neo-fm/governor.state` (host bind mount). `scripts/neo-fm-governor.py` CLI drives `pause/resume/drain/status`                              |
| Prometheus                                | `infra/docker-compose.dgx.yml` `monitoring` profile, scrapes all three services. Rules from `infra/grafana/alerts.yaml`                              |
| Grafana                                   | Same `monitoring` profile, dashboard `infra/grafana/neo-fm-overview.json` auto-provisioned                                                           |
| `infra/.env.dgx`                          | Mode 0600. Holds HMAC secrets (current + next), `neo_fm_worker` DB password, pooler DSN, HF token, `sb_secret_*`, vocal/governor/metrics env (git-ignored) |
| `neo_fm_worker` Postgres role             | `LOGIN` + strong password + `BYPASSRLS` (migration `0010`)                                                                                            |
| Vercel app                                | `apps/web` auto-promoted to production on every `main` push                                                                                          |
| GitHub secrets                            | `MUSIC_INFERENCE_HMAC_SECRET`, `VOCAL_SYNTH_HMAC_SECRET` rotated to match the on-DGX values                                                          |

CI on `main` is fully green: `ci` and `docker-build` workflows pass on
every commit since `b16df45`.

## 5. Bring-up adjustments that landed (and why)

These are the seven Phase 1–4 bring-up adjustments that were already
on `main` at v1-start; v1 work did not change them. Kept here for
reproducibility on a fresh DGX.

1. **NGC PyTorch base image bumped: `24.08-py3` → `25.11-py3`.**
   24.08 refuses to start on GB10. 25.11 is the first NGC release
   that supports GB10. 25.12 has a known torchaudio incompatibility
   on GB10 (pytorch/audio#4169).
2. **heartlib installed with `--no-deps`, then deps re-pinned without the torch stack.**
   heartlib pins `torch>=2.4,<2.11`; NGC's torch is `2.10.0a0+b558c98`
   which pip's pre-release comparator resolves as *less than 2.10*,
   so it tries to "upgrade" to `torch 2.10.0+cpu` for aarch64.
3. **`torchaudio.save` → `soundfile.write` patch in heartlib.**
   NGC 25.11 doesn't ship torchaudio, and there is no aarch64 + cu130
   wheel for NGC's torch 2.10.
4. **`infra/docker-compose.dgx.yml` binds `127.0.0.1:8000:8000`.**
   The smoke scripts curl `localhost:8000`. Loopback-only.
5. **An `ffprobe` Python shim in `~/.local/bin/`** so smoke scripts
   can read WAV duration without apt-installing ffmpeg.
6. **Migration `0010_worker_bypassrls.sql`.** `alter role
   neo_fm_worker bypassrls;` — matches the `service_role` pattern.
   Least-privilege is still enforced by column-level UPDATE grants
   from `0006_worker_role.sql`.
7. **`services/dgx-worker/app/storage.py` sends both `apikey` and `Authorization`.**
   Supabase's new `sb_secret_*` keys are opaque tokens, not JWTs, so
   the gateway expects both headers.

## 6. Reproducing v1 from a fresh DGX

```sh
git clone https://github.com/SharathSPhD/neo-fm.git
cd neo-fm

# 1. Bootstrap: writes infra/.env.dgx, builds + starts compose,
#    downloads HeartMuLa weights via scripts/download-heartmula.py.
bash scripts/dgx-bootstrap.sh

# 2. Bring up the vocal sidecar and the monitoring stack.
docker compose \
  -f infra/docker-compose.dgx.yml \
  --env-file infra/.env.dgx \
  --profile vocal --profile monitoring \
  up -d

# 3. Smoke the three healthz endpoints.
curl -sS http://127.0.0.1:8000/healthz | jq    # music-inference
curl -sS http://127.0.0.1:8089/healthz | jq    # vocal-synth
curl -sS http://127.0.0.1:9101/metrics | head  # dgx-worker exporter

# 4. Operator governor CLI.
python3 scripts/neo-fm-governor.py status
python3 scripts/neo-fm-governor.py pause --reason "manual drain"
python3 scripts/neo-fm-governor.py drain --deadline-seconds 120
python3 scripts/neo-fm-governor.py resume
```

To re-capture demo WAVs (idempotent; overwrites
`demos/phase-{1,2,3}.wav`):

```sh
export PATH="$HOME/.local/bin:$PATH"
export MUSIC_INFERENCE_URL=http://localhost:8000
scripts/build-demo.sh phase-1
scripts/build-demo.sh phase-2
scripts/build-demo.sh phase-3
git add demos/phase-{1,2,3}.wav && git commit -m "demos: refresh" && git push
```

## 7. Known sharp edges

- **Vocal-synth GPU memory pressure.** With both `music-inference`
  and `vocal-synth` resident on the same GB10, GPU memory headroom is
  tight. The governor's pre-empt path is the supported way to free
  memory cleanly. ADR 0011 §6 covers the test gates that guard this.
- **Email deliverability.** `notify-job-complete` uses Supabase native
  email, which is fine for the first cohort but should move to a
  branded sender (Resend, Postmark, etc.) before scaling.
- **Public share images.** OG images are generated on-demand by the
  `/s/[publicId]/opengraph-image` route. Vercel image transformation
  quotas apply — monitor on a per-week cadence.
- **Rate limiting.** The in-memory fallback in `middleware.ts` is
  single-instance only; production should wire `UPSTASH_REDIS_REST_URL`
  + `UPSTASH_REDIS_REST_TOKEN` for cross-region durability.

## 8. Beyond v1

Three obvious follow-on tracks; none of them blocks v1 ship:

1. **Multi-DGX scale-out.** Today the worker, music-inference, and
   vocal-synth are all colocated on `spark-5208`. The governor + lease
   protocol already supports multiple worker replicas; the missing
   piece is a small ingress on the Supabase side to load-balance pgmq
   readers.
2. **Lyric-aware regeneration.** Section regenerate currently re-runs
   the full pipeline for the affected section. A cheaper "vocal-only
   re-render" path is possible once the mixer's stem caching lands.
3. **Operator-facing run book.** This document covers reproduction;
   it does not yet cover the full failure-mode playbook (DGX reboot,
   weight cache eviction, Supabase pooler outage). Worth writing once
   we have a second on-call body.

— Sprint 8 close. v1 is ready to promote.
