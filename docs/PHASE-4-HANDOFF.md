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
- `MUSIC_INFERENCE_HMAC_SECRET` — 32-byte random; same value must be
  pasted into Vercel project env *and* the DGX-side `infra/.env.dgx`.
  The generated value is staged at `/tmp/neo-fm-hmac-secret.txt` for
  one-time copy-out by the operator and is **not** committed to git.

---

## 1. Remaining operator-only items

Three items genuinely require a human paste because the credentials
are user-bound and no MCP / agent can mint them.

### 1.1 Supabase access for CI

Needed only when a future workflow runs `supabase db push` from CI
(none of the current workflows do, so this is *not* a Phase 4 blocker
— it is the predicate for the Phase 4 polish PR that adds migration
CI).

- [ ] Generate a personal access token in
      `Supabase → Account → Access Tokens`. Add it as the
      `SUPABASE_ACCESS_TOKEN` repo secret:
      `gh secret set SUPABASE_ACCESS_TOKEN -R SharathSPhD/neo-fm`.
- [ ] Capture the project DB password (set when the project was
      created). Add it as `SUPABASE_DB_PASSWORD`.

### 1.2 Vercel deploy token (optional)

The Vercel git integration already auto-deploys on push to `main`, so
this is only needed if you want explicit CI control.

- [ ] `vercel login`, then capture a token from
      `Vercel → Account Settings → Tokens`. Add as `VERCEL_TOKEN`.

### 1.3 HMAC secret distribution

The generated `MUSIC_INFERENCE_HMAC_SECRET` (at
`/tmp/neo-fm-hmac-secret.txt`) needs to land in two more places once
copied out:

- [ ] **DGX side** — append to `infra/.env.dgx` so
      `services/dgx-worker` and `services/music-inference` both load it
      via `docker-compose --env-file`.
- [ ] **Vercel side** — Phase 4 doesn't call music-inference from the
      cloud API, but adding it now keeps Phase 5 from waiting on the
      same paste. In `Vercel → neo-fm-web → Settings → Environment
      Variables`, add `MUSIC_INFERENCE_HMAC_SECRET` for Production +
      Preview. (Encrypted, server-only.)

After copying, `shred -u /tmp/neo-fm-hmac-secret.txt` so the value
isn't left on disk.

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

## 3. Tailscale / network (deferred)

The dgx-worker calls `music-inference` over Tailscale. Worker-side
code is done; the operator's bring-up step is unchanged:

- [ ] `tailscale up --advertise-tags=tag:neo-fm-dgx` on the DGX,
      ACL allowing the worker container group to reach the
      music-inference container group on port 8000.
- [ ] Record the DGX Tailscale hostname (e.g.
      `dgx-1.taila7c2c.ts.net`) as the `MUSIC_INFERENCE_URL` value in
      `infra/.env.dgx`.

This is the only remaining Phase 4 dependency the agent cannot satisfy
on its own. Everything else has been provisioned, applied, written, or
tested in this PR.
