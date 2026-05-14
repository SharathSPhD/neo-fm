# services/music-inference

FastAPI front for HeartMuLa music generation, runs on the DGX Spark.

## Status

Phase 1: real `HeartMuLa-oss-3B-happy-new-year` inference behind a
HMAC-authenticated FastAPI surface (ADR 0003 + `docs/contracts/openapi-dgx.yaml`).

* `/healthz` is unauthenticated, reports `model_loaded`, model_version,
  and the current phase. The Docker healthcheck calls this.
* `/v1/generate` is HMAC-only. Accepts a `GenerateRequest`, returns
  audio bytes (`audio/wav` by default) with `X-NeoFM-Model-Version` and
  `X-NeoFM-Job-Id` response headers.

The model layer (`app/model.py`) exposes a `MusicModel` protocol so
tests can substitute a `FakeMusicModel` -- no torch/heartlib needed
on dev or CI.

## Run locally (no GPU)

The default Dockerfile target is `phase1` (real model). For local
exploration without weights, opt into the smoke-only mode:

```sh
uv sync
MUSIC_INFERENCE_FAKE_MODEL=1 \
MUSIC_INFERENCE_HMAC_SECRET=$(openssl rand -hex 32) \
  uv run uvicorn app.serve:app --host 0.0.0.0 --port 8000

curl http://localhost:8000/healthz
# {"status":"ok","model_loaded":true,"model_version":"fake-1.0",...}
```

`FakeMusicModel` returns a 100ms silent WAV so the dgx-worker end-to-end
contract (sign request -> POST -> upload to Storage) can be exercised
without a model.

## DGX bring-up

See [`demos/phase-1-SMOKE-HANDOFF.md`](../../demos/phase-1-SMOKE-HANDOFF.md)
for the full runbook. tl;dr:

```sh
bash scripts/dgx-bootstrap.sh
```

handles HMAC + Supabase + HF tokens, pulls weights via
`scripts/download-heartmula.py`, and brings the compose stack up
with `MUSIC_INFERENCE_STAGE=phase1`.

## Tests, lint, types

```sh
uv run pytest -q
uv run ruff check app tests
uv run mypy app
```

No GPU is needed for any of those.

## Contract

[`docs/contracts/openapi-dgx.yaml`](../../docs/contracts/openapi-dgx.yaml)
is authoritative. Update it before changing the request/response surface.
