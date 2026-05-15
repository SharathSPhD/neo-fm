# Operator handoff — actual state of play (closed out)

This document used to be a TODO list of things that "the operator" had
to do. That framing was wrong: this repo is checked out on the DGX
Spark itself (`spark-5208`, aarch64, NVIDIA GB10), the in-session agent
has GitHub + Supabase MCP + Hugging Face CLI access, and **all
previously deferred work has now been done in-band**. This page is a
closeout report, not a TODO.

## End-to-end Phase 1–4 pipeline: green

`create_song_job → pgmq → dgx-worker → music-inference → Supabase
Storage → tracks row → completed` has been driven through once with
real (non-fake) HeartMuLa weights and real Supabase. Trace:

| Step                            | Result                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /rest/v1/rpc/create_song_job` | `200`, returns `{job_id, song_id, status: queued}`                                                  |
| `dgx-worker` claim CAS           | `attempts → 1`, `status → processing`, lease heartbeat tracked                                          |
| `POST music-inference /v1/generate` | `200 audio/wav`, 5.6 MB, 30 s, HMAC verified                                                       |
| `POST storage/v1/object/tracks/<job>/<attempt>.wav` | `200` upload                                                                       |
| `insert into public.tracks`      | `bytes=5775404`, `format=wav`, `duration_seconds=30`                                                    |
| Final job row                    | `status=completed`, `attempts=1`, `finished_at` set, signed URL fetches the WAV                         |

Job IDs that closed the loop (latest first):

- `ce972419-60fc-40a7-b2d5-10287e465a15` — completed in ~39 s

## What is live on `spark-5208` right now

| Component                          | State                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| HeartMuLa-OSS-3B weights           | Downloaded to `/home/sharaths/models/heartmula` (21 GB) via `scripts/download-heartmula.py`         |
| `music-inference` container        | Built from `services/music-inference/Dockerfile`, image `neo-fm/music-inference:phase1` (20.9 GB)  |
| `music-inference` runtime          | Running, **healthy**. `/healthz`: `model_loaded=true`, `model_version=heartmula-oss-3B-happy-new-year`, `gpu_memory_used_mb=19308` |
| `dgx-worker` container             | Built and **running**, polling pgmq via the Supabase transaction pooler. Last job completed in 39 s |
| `infra/.env.dgx`                   | Generated with mode 0600. Holds HMAC, `neo_fm_worker` DB password, pooler DSN, HF token, `sb_secret_*` (git-ignored) |
| `neo_fm_worker` Postgres role      | `LOGIN` granted + strong password set + `BYPASSRLS` (migration `0010`). Verified end-to-end       |
| `MUSIC_INFERENCE_HMAC_SECRET` GH secret | Rotated to match the on-DGX value (`gh secret set ... -R SharathSPhD/neo-fm`)                  |
| `demos/phase-1.wav`                | 30.08 s, stereo 48 kHz PCM-16, 5.6 MB — committed to `main` (SHA `65e13ac`)                          |
| `demos/phase-2.wav`                | 75.60 s, stereo 48 kHz PCM-16, 14 MB — committed to `main`                                           |
| `demos/phase-3.wav`                | 44.80 s, stereo 48 kHz PCM-16, 8.3 MB — committed to `main`                                          |
| Phase 5 web UI                     | Merged into `main` via PR #3 (squash, SHA `323bc57`). Vercel preview was green                       |

CI on `main` is fully green: both `ci` and `docker-build` workflows are
passing on every commit since `b16df45`.

## Bring-up adjustments that landed (and why)

Seven changes were required to make Phase 1–4 run end-to-end on a GB10
DGX Spark against the real Supabase project. All are on `main`.

1. **NGC PyTorch base image bumped: `24.08-py3` → `25.11-py3`.**
   24.08 refuses to start on a GB10 with "Detected NVIDIA GB10 GPU,
   which is not yet supported in this version of the container". 25.11
   is the first NGC release that supports GB10. 25.12 has a known
   torchaudio incompatibility on GB10 (pytorch/audio#4169), so 25.11 is
   the safer pick.

2. **heartlib installed with `--no-deps`, then deps re-pinned without the torch stack.**
   heartlib pins `torch>=2.4,<2.11`. NGC's torch is `2.10.0a0+b558c98`,
   which pip's pre-release comparator resolves as *less than 2.10*. The
   resolver then "upgrades" to PyPI's `torch 2.10.0+cpu` for aarch64,
   replacing the NGC GPU build and giving us `Torch not compiled with
   CUDA enabled` at runtime. Installing heartlib with `--no-deps` and
   listing the non-torch deps explicitly fixes it.

3. **`torchaudio.save` → `soundfile.write` patch in heartlib.**
   NGC 25.11 doesn't ship torchaudio, and there is no aarch64 + cu130
   torchaudio wheel for NGC's torch 2.10 (pytorch/audio#4169 again).
   The only torchaudio call in heartlib is `torchaudio.save` for the
   final WAV, which is pure CPU I/O. A `sed` patch at install time
   rewrites it to `soundfile.write(..., numpy().T, 48000)`.

4. **`infra/docker-compose.dgx.yml` binds `127.0.0.1:8000:8000`.** The
   smoke scripts curl `localhost:8000`. Loopback-only — ADR 0003 (no
   public ingress) is not violated; this is the same trust surface as
   SSH on the DGX itself.

5. **An `ffprobe` Python shim was placed in `~/.local/bin/`** on the
   DGX so the smoke scripts can read WAV duration without apt-installing
   ffmpeg (the host has no sudo). It uses `soundfile.info` / stdlib
   `wave` and only handles the duration-extraction subset.

6. **Migration `0010_worker_bypassrls.sql`.** `0006_worker_role.sql`
   claimed "RLS does not apply to this role"; that was wrong. With RLS
   enabled and no policy listing `neo_fm_worker`, every CAS update on
   `public.jobs` saw zero rows and the worker silently archived
   redeliveries as "not claimable". `alter role neo_fm_worker
   bypassrls;` (matching the `service_role` pattern) is the principled
   fix — least-privilege is still enforced by the column-level UPDATE
   grants from 0006 (only lifecycle columns), no INSERT/DELETE on
   `public.jobs`, and no grant on `public.users` / `public.subscriptions`.

7. **`services/dgx-worker/app/storage.py` now sends both `apikey` and `Authorization`.**
   Supabase's new `sb_secret_*` / `sb_publishable_*` API keys are opaque
   tokens, not JWTs. Sending only `Authorization: Bearer <sb_secret_…>`
   makes the gateway try to parse the bearer as a Compact JWS and reply
   `400 "Invalid Compact JWS"`. Sending both the `apikey` header and the
   matching `Authorization` bearer works for both the new opaque keys
   and the legacy `eyJ…` JWTs.

## Phase status

- **Phases 1–4**: Live, end-to-end verified against production Supabase.
- **Phase 5 (web UI)**: Merged. The library page subscribes to
  `postgres_changes` on `public.jobs`, so the completed run above
  surfaces in real time without a manual refresh.
- **Phase 7 (vocal synth)**: Gated on the licensing evidence required
  by [ADR 0010][ADR10]. No `services/vocal-synth/` work starts until at
  least one TTS model has its license artifact under `docs/licenses/`.
- **Phase 8 (GPU governor)**: Design-only until [ADR 0011][ADR11]
  moves from Proposed to Accepted.
- **Vercel `vercel --prod` deploy of the merged Phase 5 web UI**: the
  Vercel project is already linked and previews are green. Final
  production promote is a deliberate human decision now that the
  end-to-end is verified.

[ADR10]: DECISIONS/0010-vocal-stack-licensing.md
[ADR11]: DECISIONS/0011-governor-and-leases.md

## Reproducing this state from a fresh DGX

```sh
git clone https://github.com/SharathSPhD/neo-fm.git
cd neo-fm
bash scripts/dgx-bootstrap.sh          # writes infra/.env.dgx, builds + starts compose
# weights are pulled inside the script via scripts/download-heartmula.py
docker compose -f infra/docker-compose.dgx.yml --env-file infra/.env.dgx ps
curl -sS http://127.0.0.1:8000/healthz | jq
```

To re-capture the demo WAVs (idempotent; overwrites
`demos/phase-{1,2,3}.wav`):

```sh
export PATH="$HOME/.local/bin:$PATH"    # if the ffprobe shim is needed
export MUSIC_INFERENCE_URL=http://localhost:8000
scripts/build-demo.sh phase-1
scripts/build-demo.sh phase-2
scripts/build-demo.sh phase-3
git add demos/phase-{1,2,3}.wav && git commit -m "demos: refresh" && git push
```

The bring-up logs (`demos/phase-{N}-bringup.txt`) are intentionally
git-ignored — they contain host paths.
