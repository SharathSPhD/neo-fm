# Phase 4 handoff — closed status

This was the operator-side contract for Phase 4. Phase 4 has now been
implemented in this repository against the live Supabase project
`lsxicfgqtdxvlcivlwmd` (org `Cursor`) and the Vercel project
`neo-fm-web` (`prj_kB1Qxk2rwGKVnBHmSN75EPGmeqnl`, team `ss-projects-f08e52ab`).

The rest of this document records what was done and the small set of
operator-only credentials that still need to be pasted (no agent can
mint them).

---

## 0. What was completed by the agent

### Supabase (Phase 4a)

- All Phase 4a migrations applied to `lsxicfgqtdxvlcivlwmd` via the
  Supabase MCP and registered in `supabase_migrations.schema_migrations`:
  - `0001_init.sql` — extensions (pgcrypto, pgmq, pg_jsonschema), enums,
    `public.users` + `subscriptions`, `handle_new_user` trigger.
  - `0002_song_documents.sql` — Song Document store.
  - `0003_jobs_tracks.sql` — jobs (with ADR 0007/0008 attempt_id /
    trace_id / lease_renewed_at columns) and tracks with the
    `(job_id, attempt_id)` idempotency key.
  - `0004_queue.sql` — pgmq queues `song_generation_jobs` and
    `song_generation_jobs_dlq`.
  - `0005_rls.sql` — RLS on every public table, deny-by-default with
    per-table allow policies, plus the storage.objects policy that
    authorises reads via the parent job's `user_id`.
  - `0006_worker_role.sql` — dedicated `neo_fm_worker` role (ADR 0004)
    with column-level UPDATE on `jobs` and explicit REVOKE on
    `users` / `subscriptions`.
  - `0007_queue_helpers.sql` — `public.enqueue_song_generation_job`
    SECURITY DEFINER wrapper so the cloud API can enqueue via RPC
    without granting `pgmq.*` to `service_role` callers.
- `public.handle_new_user` and `public.users_block_tier_self_update`
  hardened per Supabase advisor: `search_path = ''` pinned, EXECUTE
  revoked from public/anon/authenticated.
- Storage bucket `tracks` (private) created with audio MIME whitelist
  and 50 MB object limit; RLS policies match ADR 0005.
- Supabase advisors run after every migration; only warnings remaining
  are unrelated to Phase 4 (auth.email confirmations, etc.).
- TypeScript types regenerated into
  `apps/web/lib/supabase/database.types.ts` via the MCP after each
  schema change.

### Cloud API (Phase 4b)

- `apps/web` now ships a complete cloud-API surface:
  - `lib/supabase/server.ts` — `createServerClient()` (user-scoped) and
    `createServiceRoleClient()` (server-only, RLS bypass).
  - `lib/supabase/client.ts` — browser factory.
  - `lib/supabase/auth.ts` — `requireUser()` helper.
  - `middleware.ts` — Supabase session-cookie refresh on every request.
  - `app/api/me/route.ts` — `GET /api/me`.
  - `app/api/songs/route.ts` — `POST /api/songs` (Zod-validated; quota
    check via `user_tier_quota` + `user_jobs_count_today`; enqueue via
    `enqueue_song_generation_job`) and `GET /api/songs`.
  - `app/api/songs/[id]/route.ts` — `GET /api/songs/{id}`; signs the
    `tracks.url` with `createSignedUrl` for completed jobs.
- All routes accept either `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` so the Vercel-Supabase Marketplace
  default just works.
- Vitest suite (`apps/web/tests/`) covers auth gating, Zod validation,
  feature-flag gating, quota exhaustion, enqueue failure, happy path
  for create + list + get-by-id; 17/17 pass.

### DGX worker (Phase 4c)

- `services/dgx-worker/app/` now contains a real worker (no stubs):
  - `config.py` — strict env loader; fails fast on missing vars.
  - `models.py` — Pydantic v2 models for the queue message and the
    subset of the Song Document the worker needs.
  - `db.py` — psycopg-based wrapper for the worker DB role with
    method-level surface for pgmq (`read_one`, `set_visibility_timeout`,
    `archive`, `delete`, `reenqueue`, `send_to_dlq`) and the jobs/tracks
    lifecycle.
  - `inference_client.py` — HMAC-signed (`${ts}.${sha256(body)}`,
    SHA-256) httpx client for music-inference.
  - `storage.py` — Supabase Storage uploader with upsert semantics.
  - `worker.py` — `process_one()` driving the full lifecycle
    (CAS to processing, heartbeat task, inference call, storage upload,
    track insert, mark completed, archive) plus retry-or-DLQ branching
    on inference / storage failure.
- Pytest suite (`services/dgx-worker/tests/`): 14/14 pass, covering
  happy path, invalid payload → DLQ, missing song document → DLQ,
  retryable inference timeout, attempts exhausted → DLQ, retryable
  storage failure, idempotent replay, and live heartbeat during a
  long-running inference call.
- `ruff` clean on both `app/` and `tests/`.

### GitHub Actions secrets (provisioned)

Set on `SharathSPhD/neo-fm` (verifiable with
`gh secret list -R SharathSPhD/neo-fm`):

- `SUPABASE_PROJECT_REF` = `lsxicfgqtdxvlcivlwmd`.
- `MUSIC_INFERENCE_HMAC_SECRET` — 32-byte random; **DGX-only** secret per
  [ADR 0003](DECISIONS/0003-internal-api-hmac.md) ("the same secret never
  lives in Vercel"). It is staged in the GitHub Actions secret store only
  so that `scripts/dgx-bootstrap.sh` can pull it onto the DGX via
  `gh secret get`; it is **not** consumed by any cloud workflow and is
  **not** added to Vercel env. The generated value is staged at
  `/tmp/neo-fm-hmac-secret.txt` for one-time copy-out by the operator and
  is **not** committed to git.

---

## 1. Operator-only items (and how the agent has narrowed them)

### 1.1 HMAC secret distribution — now a single bootstrap call

The generated `MUSIC_INFERENCE_HMAC_SECRET` was set as a GitHub Actions
secret on `SharathSPhD/neo-fm` during Phase 4 and staged at
`/tmp/neo-fm-hmac-secret.txt` on the agent's workstation. To install it
on the DGX, the operator now runs:

```sh
git clone https://github.com/SharathSPhD/neo-fm.git
cd neo-fm
# Either pre-export the HMAC value...
export MUSIC_INFERENCE_HMAC_SECRET=...                # paste once
# ...or let dgx-bootstrap.sh prompt you for it.
bash scripts/dgx-bootstrap.sh
```

`scripts/dgx-bootstrap.sh` writes `infra/.env.dgx` (mode 0600), validates
that `docker compose config` parses, pulls HeartMuLa weights into
`/mnt/models/heartmula`, and runs `docker compose up -d`. Re-running the
script is idempotent (existing `.env.dgx` values are preserved unless
you pass `--reset`).

Per ADR 0003 the cloud API does **not** need this secret — the cloud
never reaches DGX. The earlier draft of this doc that mentioned a
Vercel paste was wrong.

### 1.2 Supabase access for CI (genuinely operator-only)

Needed only when a future workflow runs `supabase db push` from CI.
None of the current workflows do — all Phase 4 migrations were already
applied to `lsxicfgqtdxvlcivlwmd` via MCP and are recorded in
`supabase_migrations.schema_migrations`. CI for new migrations becomes
useful around Phase 6+.

- [ ] Generate a token in `Supabase → Account → Access Tokens`. Add it
      as a repo secret:
      `gh secret set SUPABASE_ACCESS_TOKEN -R SharathSPhD/neo-fm`.
- [ ] Capture the project DB password (set when the project was
      created). Add it as `SUPABASE_DB_PASSWORD`.

A copy-pasteable workflow template lives in
`docs/PHASE-4-HANDOFF.md.workflow.yml` (in this repo at `docs/`). Drop
it into `.github/workflows/supabase-migrations.yml` when the two
secrets are in place; the workflow includes a precheck step so it
skips cleanly until then.

### 1.3 Vercel deploy token (optional, low value)

The Vercel git integration already auto-deploys on push to `main`, so
this is only needed if you want CI-driven promotions instead of letting
Vercel's webhook do it.

- [ ] `vercel login`, capture a token from
      `Vercel → Account Settings → Tokens`. Add as `VERCEL_TOKEN`.

After copying the HMAC value out of `/tmp/neo-fm-hmac-secret.txt`,
`shred -u /tmp/neo-fm-hmac-secret.txt` so the value isn't left on disk.

---

## 2. Verification commands

After the operator items above are done, the following should all
return clean:

```sh
gh secret list -R SharathSPhD/neo-fm
# Expect at minimum: SUPABASE_PROJECT_REF, MUSIC_INFERENCE_HMAC_SECRET,
# plus whichever optional secrets you pasted.

pnpm --filter @neo-fm/web test
pnpm --filter @neo-fm/web typecheck
pnpm --filter @neo-fm/web build

cd services/dgx-worker && uv sync && uv run pytest -q && uv run ruff check
```

The DGX-side smoke test (a real job round-trip through pgmq →
music-inference → Storage) still needs the DGX bring-up items under
[`demos/phase-1-SMOKE-HANDOFF.md`](../demos/phase-1-SMOKE-HANDOFF.md);
those are tracked separately and not part of Phase 4 close.

---

## 3. Tailscale — not required for Phase 4

The pre-Phase-4 draft of this doc said the worker reaches
music-inference "over Tailscale". Looking at the actual implementation:

- `services/dgx-worker` connects to `MUSIC_INFERENCE_URL`, which defaults
  to `http://music-inference:8000` — the docker-compose internal bridge.
- It also connects to Supabase (`SUPABASE_URL`, `PG_DSN`) over **public**
  TLS endpoints.

There is no leg of the data path that crosses an organisational LAN, so
Tailscale would only add hops without solving an authentication problem
(HMAC + service-role + RLS already do that). The `tailscale up` step is
therefore **out of Phase 4 scope** and intentionally not run.

It re-enters scope only when:

1. (Phase 11 observability) The Prometheus / Grafana / Loki sinks pull
   metrics *into* the DGX from outside, or
2. A future DGX cluster needs site-to-site key sharing the secret
   manager can't cover.

When that happens, the right ADR is "0009-tailscale-for-pull-observability";
this one stays archived.

## 4. End-to-end verification

Once the operator items above are addressed (only HMAC distribution is
strictly necessary for Phase 4), the following should all return clean:

```sh
gh secret list -R SharathSPhD/neo-fm
# Expect at minimum: SUPABASE_PROJECT_REF, MUSIC_INFERENCE_HMAC_SECRET.

pnpm --filter @neo-fm/web test
pnpm --filter @neo-fm/web typecheck
pnpm --filter @neo-fm/web build

cd services/dgx-worker && uv sync && uv run pytest -q && uv run ruff check
```

The DGX smoke (real WAV round-trip) lands with the Phase 1 PR that
integrates HeartMuLa; see `demos/phase-1-SMOKE-HANDOFF.md` once that PR
merges.
