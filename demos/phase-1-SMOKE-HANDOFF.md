# Phase 1 — smoke handoff

Phase 1 wires real `HeartMuLa-oss-3B-happy-new-year` inference into
`services/music-inference`. The Phase 1 Ralph-Wiggum gate ("real, not
fake") closes once `demos/phase-1.wav` exists.

## What lands in this PR

* `services/music-inference/app/model.py` — `HeartMuLaModel`
  wraps `heartlib.HeartMuLaGenPipeline`, lazy-imports torch+heartlib so
  CI never has to ship them, and a `FakeMusicModel` test double.
* `services/music-inference/app/serve.py` — `POST /v1/generate` is no
  longer a 501 stub. It coerces the request, calls the active model on
  a threadpool, and streams WAV bytes back with
  `Content-Type: audio/wav`.
* Eager model load on startup (TRIZ C2). 503 until weights are ready;
  `/healthz` honestly reports `model_loaded=false` during the warm-up
  window so the orchestrator can keep traffic off.
* `services/music-inference/Dockerfile` — two stages. `phase0` is the
  unchanged python:3.12-slim CI smoke image; `phase1` is
  `nvcr.io/nvidia/pytorch:24.08-py3` with heartlib cloned + installed.
* `infra/docker-compose.dgx.yml` — switches the `music-inference`
  target to `phase1`, mounts `/mnt/models/heartmula:/mnt/models/heartmula:ro`,
  and requests the NVIDIA GPU runtime.
* `scripts/download-heartmula.py` — pulls the three HF repos the
  heartlib README pins into `$HEARTMULA_CKPT_DIR/ckpt/{HeartCodec-oss,
  HeartMuLa-oss-3B}` plus `gen_config.json` + `tokenizer.json`.
* 20 pytest cases in `services/music-inference/tests` cover request
  → lyrics/tags translation, transliteration preference for Indic
  scripts, HMAC + 503 surface, healthz behaviour.

CI is fully green without a GPU or weights: tests run against
`FakeMusicModel`, `ruff` is clean, `mypy --strict` is clean.

## What still requires the DGX

The actual WAV (`demos/phase-1.wav`) needs:

1. NVIDIA GPU (Grace-Blackwell or Hopper) with NVIDIA Container Toolkit.
2. ~30 GB of disk for the HeartMuLa weights.
3. `HF_TOKEN` (any read-scope token; the repos are public but a token
   avoids rate-limit pain on the first run).

## Operator runbook

On the DGX host, once:

```sh
git clone https://github.com/SharathSPhD/neo-fm.git
cd neo-fm

# One-shot env setup (writes infra/.env.dgx, mode 0600, then
# pulls weights, then `docker compose up -d --build`).
bash scripts/dgx-bootstrap.sh
```

The bootstrap script idempotently handles HMAC secret installation,
Supabase + Postgres credentials, the HF token, and the HeartMuLa
download. See `docs/PHASE-4-HANDOFF.md` for the source-of-truth.

To reproduce the Phase 1 demo afterwards:

```sh
export MUSIC_INFERENCE_URL=http://localhost:8000
export MUSIC_INFERENCE_HMAC_SECRET=$(grep '^MUSIC_INFERENCE_HMAC_SECRET=' infra/.env.dgx | cut -d= -f2)
scripts/build-demo.sh phase-1
```

The script signs the canonical Phase 1 request, POSTs to
`/v1/generate`, copies the resulting audio to `demos/phase-1.wav`, and
runs `ffprobe` for a duration sanity check.

## Verification (without the DGX)

These all run cleanly on any laptop:

```sh
cd services/music-inference
uv sync
uv run pytest -q          # 20 passed
uv run ruff check app tests
uv run mypy app           # strict, clean
```

The HTTP surface contract (`docs/contracts/openapi-dgx.yaml`) is
unchanged from Phase 0 except for the 200 response body now being
audio bytes instead of an explicit 501. The Phase 2 + Phase 3 golden
requests (`demos/phase-{2,3}-request.golden.json`) remain
byte-identical, so the existing co-composer + lyrics tests still pin
the upstream surface.

## Open follow-ups (not Phase 1 blockers)

* Phase 7 will introduce a separate `services/vocal-synth` for Indic
  vocals (svara-TTS Kenpath + AI4Bharat Indic-TTS G2P). HeartMuLa
  itself does not natively support Hindi or Kannada; the
  transliteration path in `app/model.py::build_lyrics_block` is the
  bridge until then.
* Inference acceleration / streaming inference is on heartlib's own
  TODO list (RTF ≈ 1.0 today). When upstream ships it, the worker's
  600s timeout becomes wasteful and we'll tune it down.
* `HEARTLIB_REF` in the Dockerfile is pinned to `main`; promote to a
  SHA in the Phase 6 hardening PR.
