# services/vocal-synth (Sprint 5 real impl)

Indic singing voice synthesis sidecar. The dgx-worker calls
`/v1/vocalize` with section-level lyrics + transliteration + raga +
target seconds; the response is a mono WAV at the requested sample
rate that the worker's mixer overlays on top of the HeartMuLa
instrumental.

## API

See `docs/contracts/openapi-vocal-synth.yaml` for the authoritative
contract. Two endpoints:

- `GET /healthz` — service health + model state. Unauthenticated.
- `POST /v1/vocalize` — synthesise a vocal stem. HMAC-authenticated
  (`X-NeoFM-Signature` + `X-NeoFM-Timestamp`, see ADR 0003).

## Model backends

`VOCAL_MODEL_BACKEND` env (default `auto`):

| value     | description                                              |
| --------- | -------------------------------------------------------- |
| `auto`    | Prefer `svara`, fall back to fake when weights missing.  |
| `svara`   | `kenpath/svara-tts-v1` — Indic singing voice (preferred). |
| `parler`  | `ai4bharat/indic-parler-tts` — multilingual fallback.    |

Set `NEO_FM_REQUIRE_REAL_MODEL=1` in production to refuse the fake.

Weights are pulled to the HF cache on the DGX host once with:

```bash
HF_HOME=/var/cache/huggingface \
  python -c "from huggingface_hub import snapshot_download; \
             snapshot_download('kenpath/svara-tts-v1')"
```

The container mounts the cache read-only — it never downloads at
boot (matches the HeartMuLa pattern in `music-inference`).

## Local fake

For local docker-compose smoke tests we ship a `FakeVocalModel` that
generates a soft tone whose pitch tracks a simple raga-shaped contour.
It exists so the end-to-end pipeline (creation → worker → vocal-synth
→ mixer → tracks bucket) can be exercised on machines without GPU.

## Build

```bash
docker build -t neo-fm-vocal-synth:dgx --target dgx ./services/vocal-synth
docker build -t neo-fm-vocal-synth:ci  --target ci  ./services/vocal-synth
```
