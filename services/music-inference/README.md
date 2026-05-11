# services/music-inference

FastAPI front for HeartMuLa music generation, runs on the DGX Spark.

## Phase 0 (now)

- Thin FastAPI app. `/healthz` returns ok. `/v1/generate` returns 501.
- Container base is `python:3.12-slim` so CI on x86 runners can prove it builds.

## Phase 1 (next)

- Switch base to `nvcr.io/nvidia/pytorch:24.08-py3` (aarch64, Grace-Blackwell optimised).
- Install `heartmula` and download `m-a-p/HeartMuLa-oss-3B` into a mounted `models/` volume.
- Eager model load at process startup (TRIZ C2).
- `POST /v1/generate` returns a real WAV.

## Run locally

```sh
uv sync
uv run uvicorn app.serve:app --host 0.0.0.0 --port 8000 --reload
curl localhost:8000/healthz
```

## Contract

[`docs/contracts/openapi-dgx.yaml`](../../docs/contracts/openapi-dgx.yaml).
