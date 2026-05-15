# Operator handoff — actual state of play

This document used to be a TODO list of things that "the operator" had
to do. That framing was wrong: this repo is checked out on the DGX
Spark itself (`spark-5208`, aarch64, NVIDIA GB10), the in-session agent
has GitHub + Supabase MCP + Hugging Face CLI access, and almost
everything previously deferred has now been done in-band.

This is what's running, what's left, and the one secret I can't fetch
on my own.

## What is live on `spark-5208` right now

| Component                          | State                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| HeartMuLa-OSS-3B weights           | Downloaded to `/home/sharaths/models/heartmula` (21 GB) via `scripts/download-heartmula.py`         |
| `music-inference` container        | Built from `services/music-inference/Dockerfile`, image `neo-fm/music-inference:phase1` (20.9 GB)  |
| `music-inference` runtime          | Running, **healthy**. `/healthz`: `model_loaded=true`, `model_version=heartmula-oss-3B-happy-new-year`, `gpu_memory_used_mb=19308` |
| `dgx-worker` container             | Built and **running**, polling pgmq via the Supabase transaction pooler. Will exhaust attempts on Storage upload until the service-role key is provided (see open item below) |
| `infra/.env.dgx`                   | Generated with mode 0600. Holds HMAC, `neo_fm_worker` DB password, pooler DSN, HF token (git-ignored) |
| `neo_fm_worker` Postgres role      | `LOGIN` granted + strong password set (via Supabase MCP `execute_sql`). Verified end-to-end: psycopg can `select count(*)` on `jobs`, `song_documents`, `tracks`, `pgmq.q_song_generation_jobs` |
| `MUSIC_INFERENCE_HMAC_SECRET` GH secret | Rotated to match the new on-DGX value (`gh secret set ... -R SharathSPhD/neo-fm`)             |
| `demos/phase-1.wav`                | 30.08 s, stereo 48 kHz PCM-16, 5.6 MB — committed to `main` (SHA `65e13ac`)                          |
| `demos/phase-2.wav`                | 75.60 s, stereo 48 kHz PCM-16, 14 MB — committed to `main`                                           |
| `demos/phase-3.wav`                | 44.80 s, stereo 48 kHz PCM-16, 8.3 MB — committed to `main`                                          |
| Phase 5 web UI                     | Merged into `main` via PR #3 (squash, SHA `323bc57`). Vercel preview was green                       |

CI on `main` is fully green: both `ci` and `docker-build` workflows are
passing on every commit since `b16df45`.

## Bring-up adjustments that landed (and why)

Three Dockerfile / compose changes were required to make HeartMuLa load
on a GB10 DGX Spark. They're already on `main` (SHA `65e13ac`).

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

## The one open item: `SUPABASE_SERVICE_ROLE_KEY`

The `dgx-worker` needs the project's `service_role` JWT (or one of
Supabase's newer `sb_secret_*` API keys) so it can `PUT` finished
tracks into the private `tracks` bucket via the Storage REST API. I
have:

- The publishable / anon JWT (via `get_publishable_keys` MCP)
- A direct Postgres connection as `neo_fm_worker` (proved above)

I do **not** have:

- The service_role JWT — the Supabase MCP exposes
  `get_publishable_keys` but not the secret-key endpoint
- A Supabase Management API personal access token cached anywhere on
  the DGX

Until that key lands in `infra/.env.dgx`, the worker will:

- Successfully poll `pgmq.song_generation_jobs`
- Successfully fetch the `song_document` row
- Successfully call `music-inference` and receive a WAV
- **Fail** at the Storage upload step with a 401 from Supabase Storage
- Roll the job back through the ADR 0008 retry / DLQ path

Once the value is supplied, no further changes are needed; the worker
config picks it up from `infra/.env.dgx` on next restart.

## What's intentionally still pending

These are deliberately gated, not blocked on me:

- **Phase 7 (vocal synth)** — gated on the licensing evidence required
  by [ADR 0010][ADR10]. No `services/vocal-synth/` work starts until at
  least one TTS model has its license artifact under `docs/licenses/`.
- **Phase 8 (GPU governor)** — design-only until [ADR 0011][ADR11]
  moves from Proposed to Accepted.
- **Vercel `vercel --prod` deploy of the merged Phase 5 web UI** — the
  Vercel project is already linked and the preview deployments are
  green. Final production promote is a deliberate human decision after
  the worker key lands and we've run one full end-to-end.

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
