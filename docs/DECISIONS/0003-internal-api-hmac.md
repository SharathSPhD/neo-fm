# ADR 0003: Internal API authenticated by shared-secret HMAC

Status: Accepted

## Context

The internal music-inference service (`services/music-inference`) exposes
`POST /v1/generate` and `GET /healthz` on the docker-compose network on DGX.
Only `dgx-worker` is supposed to call it. There is no Tailscale ACL between
the two containers — they share a docker bridge. Without authentication, any
process on the DGX host with network access to that bridge can submit
inference jobs (occupying GPU + producing audio under our service identity).

The cloud → DGX path is closed by design (DGX initiates outbound; cloud never
reaches in). That does **not** make the internal hop safe. A misconfigured
container, a future LLM-tuning side-car sharing the network, or a curl from
the host shell would all bypass the trust boundary.

We considered:

1. **mTLS between worker and inference.** Real, but heavy: requires a CA,
   cert rotation, an init-container per service. Overkill for two containers
   on the same compose stack.
2. **Network policy only (compose isolation).** Doesn't help if the threat
   is something on the same compose network.
3. **Shared-secret HMAC over the request body + timestamp.** Cheap, stateless,
   verifiable per-request, and small enough to ship in Phase 1 without
   building infra.

## Decision

`services/music-inference` requires an HMAC-SHA256 signature on every request
to `/v1/generate`. The signature is computed by `dgx-worker` over:

```
sha256( body_bytes || "\n" || timestamp_unix_seconds )
```

…using a per-environment shared secret `MUSIC_INFERENCE_HMAC_SECRET` (32+
bytes, random, injected via docker-compose `env_file`, never logged).
Requests carry:

- `X-NeoFM-Timestamp: <unix-seconds>`
- `X-NeoFM-Signature: <hex sha256 hmac>`

Server rejects with 401 if the timestamp is more than 60s skewed or the
signature is invalid. `GET /healthz` is exempt (liveness probe).

The secret rotates by:

1. Adding a second secret (`MUSIC_INFERENCE_HMAC_SECRET_NEXT`) to the server.
2. Switching the worker to it.
3. Removing the old one after one job-cycle.

OpenAPI declares this as a `hmacAuth` security scheme (apiKey-in-header form)
on `openapi-dgx.yaml`. See ADR 0004 for who holds which secrets.

## Consequences

- Anyone on the docker network without the secret cannot drive the model.
- Compose stack grows by one env var; nothing else changes operationally.
- This is **not** a substitute for proper mTLS once we have more than two
  internal services or any multi-tenant DGX context (Phase 7 vocal-synth
  comes onto the same bus and gets its own ADR if symmetry isn't enough).
- Cloud is unaffected — cloud already cannot reach DGX, so the same secret
  never lives in Vercel.
