# Operator handoff — what only a human at the DGX can do

Phases 0–5 are landed in code. CI is green, the cloud stack (Supabase
schema, RPC, API, worker) is live on `lsxicfgqtdxvlcivlwmd`, the web UI
is scaffolded in `apps/web`. Three things remain that the agent
cannot — and intentionally should not — do:

1. Pull the HeartMuLa-OSS-3B weights onto the DGX.
2. Run `scripts/build-demo.sh phase-{1,2,3}` to capture the three WAV
   demos (`demos/phase-1.wav`, `demos/phase-2.wav`, `demos/phase-3.wav`).
3. (Only if it persists) fix the self-hosted GitHub runner permissions
   so the `docker-build` job stops failing at the "Set up job" step.

Everything else is operator-side polish. This doc is the single
authoritative checklist.

## 0. Pre-flight (5 minutes)

You will need:

| Item                                      | Where to get it                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| DGX host with NVIDIA driver + Container Toolkit | The Grace-Blackwell / Hopper box.                                                       |
| `git`, `docker`, `docker compose v2`, `openssl`, Python 3.10+ | All standard on a fresh DGX image.                                       |
| ~30 GB free disk on `/mnt/models`         | HeartMuLa weights + the two HF sibling repos.                                                  |
| `MUSIC_INFERENCE_HMAC_SECRET`             | Already a GitHub Actions secret on `SharathSPhD/neo-fm`. Re-fetch via `gh secret list` or regenerate (see step 2 below). |
| `SUPABASE_SERVICE_ROLE_KEY`               | Supabase Dashboard → Project `lsxicfgqtdxvlcivlwmd` → API → service_role.                      |
| `PG_DSN` for `neo_fm_worker`              | Supabase Dashboard → Database → Connection string → Transaction pooler, port `6543`, role `neo_fm_worker`, password from migration `0006`. |
| `HF_TOKEN` (read scope is enough)         | <https://huggingface.co/settings/tokens>. Free account, public repos.                          |

Trust boundary (don't drift): the DGX is **outbound-only** per [SPEC §2.1][SPEC]
and [ADR 0003][ADR3]. Tailscale is not the API trust boundary. Do not open
inbound HTTPS to the DGX. SSH/IDE access stays on plain LAN. See
[`docs/rejected/tailscale-funnel-pivot.md`][REJ] for context.

[SPEC]: SPEC.md
[ADR3]: DECISIONS/0003-internal-api-hmac.md
[REJ]: rejected/tailscale-funnel-pivot.md

## 1. Bootstrap the DGX (one command)

```sh
git clone https://github.com/SharathSPhD/neo-fm.git
cd neo-fm

# Idempotent. Writes infra/.env.dgx with 0600 perms,
# pulls HeartMuLa, brings the compose stack up.
bash scripts/dgx-bootstrap.sh
```

The script will prompt for any secret it can't find in env or
`infra/.env.dgx`. Use `--reset` to regenerate the env file from
scratch, `--skip-models` to defer the 30 GB download to a later run,
`--no-up` to write env without starting containers.

After it finishes, verify the stack:

```sh
docker compose -f infra/docker-compose.dgx.yml ps
# music-inference should be (healthy)
# dgx-worker should be running (it'll happily idle if the queue is empty)

curl -sS http://localhost:8000/healthz | jq
# { "status": "ok", "model_loaded": true, "model_version": "happy-new-year",
#   "gpu_memory_used_mb": <int>, "phase": 1, ... }
```

If `model_loaded` is `false`, the weights are still warming. Wait
30 seconds and re-check; the eager-load path (ADR pinned in Phase 1)
will flip it to `true` once `HeartMuLaGenPipeline` finishes loading.

## 2. Capture the three demo WAVs

These run **on the DGX** and require step 1 to be healthy.

```sh
export MUSIC_INFERENCE_URL=http://localhost:8000
export MUSIC_INFERENCE_HMAC_SECRET=$(grep '^MUSIC_INFERENCE_HMAC_SECRET=' infra/.env.dgx | cut -d= -f2)

scripts/build-demo.sh phase-1
scripts/build-demo.sh phase-2
scripts/build-demo.sh phase-3
```

Each call:

1. Loads the canonical pinned request from
   `demos/phase-{N}-request.golden.json`.
2. Computes the HMAC signature.
3. POSTs to `/v1/generate` and streams the WAV response.
4. Writes `demos/phase-{N}.wav`.
5. Runs `ffprobe -hide_banner -i demos/phase-{N}.wav` for a duration
   sanity check.

Expected durations: 30s (phase-1), 60s (phase-2), 60s (phase-3).
HeartMuLa's RTF ≈ 1.0 right now, so each demo takes roughly its own
duration in wall-clock to produce, plus a couple of seconds of
overhead.

Commit the three WAVs:

```sh
git add demos/phase-1.wav demos/phase-2.wav demos/phase-3.wav
git commit -m "demos: capture phase-1/2/3 WAVs on DGX bring-up"
git push
```

That commit closes the Phase 1/2/3 Ralph-Wiggum "real, not fake" gate.

## 3. (Conditional) Fix the `docker-build` CI failure

If `.github/workflows/docker-build.yml` runs are still red on
`origin/main` after this handoff, with the failure stuck at
**Set up job**, the cause is almost always the self-hosted runner
lacking the permissions for the action to check out. Two fixes:

a. **Preferred — give the runner the right permissions in repo
   settings** (Settings → Actions → Runners → select runner →
   "Allow this runner to run on public + private repos"; also check
   that `actions: write` is allowed in
   Settings → Actions → General → Workflow permissions).

b. **Fallback — switch to GitHub-hosted `ubuntu-latest`** in the
   `docker-build.yml` workflow (`runs-on: ubuntu-latest`) and let
   GitHub bill the minutes. CPU-only Docker builds are fine on the
   hosted runner; the GPU path runs only on the DGX via
   `dgx-bootstrap.sh`, not in CI.

After applying either fix, re-trigger via the GitHub UI or push an
empty commit. The job should now reach the "Login to GHCR" step.

## 4. What you do **not** need to do

The agent has already completed these. Listing them so you can ignore
the temptation to redo them:

- All Supabase Phase 4a migrations (`0001`..`0009`) are applied.
- `neo_fm_worker` role exists with `pgmq.*`, `jobs`, `tracks`, and
  Storage grants. Password is in migration `0006`.
- Vercel project `neo-fm-web` is linked, environment variables
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` are set. `MUSIC_INFERENCE_HMAC_SECRET`
  is **not** on Vercel — and must stay off, per [ADR 0003][ADR3].
- Web UI Phase 5 scaffolding (auth, library, creation canvas) is on
  branch `phase/5-web-ui`. It is intentionally not merged to `main`
  until you've run step 2 and confirmed the loop closes end-to-end.

## 5. Reporting back

After step 2 produces the three WAVs and you've pushed them:

```sh
# Quick sanity report you can paste into the next session
echo "phase-1 $(ffprobe -i demos/phase-1.wav -show_entries format=duration -v quiet -of csv=p=0)"
echo "phase-2 $(ffprobe -i demos/phase-2.wav -show_entries format=duration -v quiet -of csv=p=0)"
echo "phase-3 $(ffprobe -i demos/phase-3.wav -show_entries format=duration -v quiet -of csv=p=0)"
```

If any duration is more than ±10% off the target (30 / 60 / 60), open
an issue with the worker logs from
`docker compose logs music-inference dgx-worker --since 10m` attached.
The structured logs include `wall_seconds`, `gpu_memory_used_mb`, and
`model_version` per [ADR 0007][ADR7] — enough to diagnose any drift
without a live debug session.

[ADR7]: DECISIONS/0007-observability-from-phase-1.md

## 6. What's next after the demos exist

Once `demos/phase-{1,2,3}.wav` are committed:

- Merge `phase/5-web-ui` into `main` and deploy to Vercel via
  `vercel --prod`.
- Walk through ADR [0010][ADR10] — collect the licensing artifacts
  for any Phase 7 vocal-synth candidates (svara-TTS, Kenpath,
  AI4Bharat Indic-TTS). Until those land under `docs/licenses/`,
  Phase 7 implementation stays paused per the ADR.
- Walk through ADR [0011][ADR11] — promote it to Accepted before
  beginning Phase 8 (GPU governor) implementation.

[ADR10]: DECISIONS/0010-vocal-stack-licensing.md
[ADR11]: DECISIONS/0011-governor-and-leases.md

That is the entire remaining manual surface. Everything else has been
either implemented, tested, or explicitly gated behind an ADR that
must be accepted first.
