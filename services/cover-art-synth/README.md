# cover-art-synth

Internal FastAPI sidecar for cover-art generation. Never exposed to the
public internet — the Next.js layer enqueues a `cover_art_jobs` pgmq
message, and `dgx-worker`'s cover-art consumer calls this service with
HMAC-signed requests.

## Endpoints

| Method | Path                  | Purpose                                                                 |
|--------|-----------------------|-------------------------------------------------------------------------|
| GET    | `/healthz`            | Service + model load state.                                             |
| GET    | `/metrics`            | Prometheus exposition.                                                  |
| POST   | `/v1/generate-cover`  | HMAC-protected. Returns a PNG square (1024×1024 by default).            |

The HMAC scheme is identical to `services/vocal-synth` and
`services/music-inference` (ADR 0003): the request carries
`X-NeoFM-Signature: hex(hmac_sha256(body || "\n" || ts, secret))` and
`X-NeoFM-Timestamp: <unix-seconds>` (±60s skew). Two-key rotation is
supported via `COVER_ART_HMAC_SECRET_NEXT`.

## Backends

`COVER_ART_BACKEND` selects the model:

| value          | behaviour                                                                       |
|----------------|---------------------------------------------------------------------------------|
| `z-image`      | Default. Loads `Tongyi-MAI/Z-Image-Turbo` via `diffusers.ZImagePipeline` (bf16, 8 steps). Requires `diffusers>=0.36` and ~15 GB of HF cache. |
| `sdxl-turbo`   | Fallback. Loads `stabilityai/sdxl-turbo` via `AutoPipelineForText2Image` (fp16, 4 steps). |
| `fake`         | Deterministic PIL gradient. Always selected in CI/tests.                         |

`COVER_ART_MODEL_ID` overrides the default repo for either real backend.
Historical note: the `z-image` default used to be `tonyassi/z-image-turbo`,
which 404s upstream and caused the lifespan to silently fall through to
`fake`. The current default points at the official Tongyi-MAI release.

The lifespan boot tries the requested backend; if `diffusers` /
`torch` aren't installed (the CI image), it falls back to `fake`
automatically so unit tests don't need GPU drivers.
