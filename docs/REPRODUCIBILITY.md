# neo-fm reproducibility -- zero to running

This document is the single source of truth for **standing up a
working neo-fm v1.1 environment from scratch**. If anything below is
out of date with `main`, fix it here and update the migration list in
`infra/supabase/migrations/`.

Three target environments are covered:

1. **Local dev (Mac / Linux / WSL)** -- web app + Supabase remote +
   `FakeMusicModel` + `FakeVocalModel`.
2. **DGX Spark on-prem** -- real GPU inference + vocal synth +
   governor + observability stack.
3. **Production (Vercel + Supabase managed)** -- the same Supabase
   project the DGX talks to. No special DNS or peering.

You do not need (3) to run (1) and (2). You can run only (1) for UI
work, only (2) for inference work, and the full stack for end-to-end
demos.

---

## 0. Hard prerequisites

| Tool | Minimum | Used for | Install |
| --- | --- | --- | --- |
| Node | 20.x | apps/web, tools/codegen | `mise install` or system pkg |
| pnpm | 9.x | monorepo install | `corepack enable && corepack prepare pnpm@9.7.0 --activate` |
| Python | 3.11 | dgx-worker, music-inference, vocal-synth | `uv python install 3.11` |
| uv | 0.4+ | python deps + venvs | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Docker + compose v2 | latest | DGX runtime, monitoring | distro packages |
| Supabase CLI | 1.190+ | migrations, edge fn | `pnpm dlx supabase@latest --help` |
| Git LFS | any | weights (if cached locally) | distro packages |
| Tailscale | latest | DGX <-> operator reachability | https://tailscale.com |

On the DGX target you also need:
- NVIDIA driver 555.42+ (GB10 / Grace Blackwell)
- NVIDIA container toolkit
- A static `tailnet` hostname (we use `spark-5208`)

---

## 1. Local dev (web only)

```sh
git clone https://github.com/SharathSPhD/neo-fm.git
cd neo-fm
pnpm install
cp apps/web/.env.example apps/web/.env.local
# Fill in:
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY     (sb_publishable_*)
#   SUPABASE_SERVICE_ROLE_KEY                (sb_secret_*)
#   NEO_FM_INTERNAL_HMAC_SECRET              (any 32-byte hex)
#   HF_TOKEN                                 (only if you want real cover art)
#   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   (optional)
pnpm --filter=@neo-fm/web dev
# -> http://localhost:3000
```

Verify the smokes:

```sh
pnpm --filter=@neo-fm/web typecheck
pnpm --filter=@neo-fm/web test -- --run
pnpm --filter=@neo-fm/web lint
curl -sS http://localhost:3000/api/healthz | jq
curl -sS http://localhost:3000/api/health | jq
```

`/api/health` should report `{ "status": "ok", "checks": { "supabase":
{ "status": "ok", ... }, "upstash": { "status": "missing" | "ok" } } }`.

To re-pull database types after editing migrations:

```sh
pnpm dlx supabase@latest gen types typescript \
  --project-id lsxicfgqtdxvlcivlwmd \
  > apps/web/lib/supabase/database.types.ts
```

(or use the Supabase MCP `generate_typescript_types` tool inside
Cursor agents).

---

## 2. Supabase project (one-time, then idempotent)

If you are bringing up a fresh Supabase project (greenfield):

```sh
pnpm dlx supabase@latest projects create neo-fm \
  --org-id <your-org> --region ap-south-1 --db-password ...
```

Apply migrations in order. The agent stack uses the Supabase MCP
`apply_migration`; from the CLI:

```sh
for f in infra/supabase/migrations/*.sql; do
  pnpm dlx supabase@latest db push --file "$f"
done
```

What each migration installs is listed in
`infra/supabase/migrations/README.md`. As of v1.1 the tail of the
list is:

| Migration | Sprint | What it adds |
| --- | --- | --- |
| 0017_song_title | Sprint C (c) | `song_documents.title` + index |
| 0018_vocal_telemetry | Sprint D | `tracks.vocal_*` columns + `recent_vocal_quality` view |
| 0019_password_history | Sprint H reserved (unused; placeholder) | n/a |
| 0020_handle_validate | Sprint G | `validate_handle()` trigger |
| 0021_feedback | Sprint E | `public.feedback` + `submit_feedback` rpc |
| 0022_library_upgrades | Sprint F | `jobs.is_favorite` + `toggle_favorite`/`rename_song` + delete rls |
| 0023_user_handles | Sprint G | `users.handle` + `public_profiles` view + `claim_handle` rpc |
| 0024_social | Sprint G | likes / follows / reports + rpcs |
| 0025_stems | Sprint H | `track_stems` table |
| 0026_cover_art | Sprint H | `cover_art` table |
| 0027_security_advisors | Sprint I | views to SECURITY INVOKER + tightened policies |

Deploy edge functions:

```sh
pnpm dlx supabase@latest functions deploy notify-job-complete
pnpm dlx supabase@latest functions deploy orphan-reconciler
```

Both must have the env vars set in the Supabase dashboard:

- `SUPABASE_SERVICE_ROLE_KEY`
- `NEO_FM_RESEND_API_KEY` (for notify-job-complete; optional in dev)
- `NEO_FM_PUBLIC_APP_URL` (e.g. `https://neo-fm.vercel.app`)

Auth settings to flip in the dashboard:

- **Authentication -> URL configuration**:
  - Site URL: production URL
  - Additional redirect URLs: `http://localhost:3000/auth/callback`,
    `https://*.vercel.app/auth/callback`
- **Authentication -> Policies -> Password security**:
  - Enable "Check passwords against HaveIBeenPwned" (closes the
    `auth_leaked_password_protection` advisor warning).

---

## 3. DGX Spark on-prem

### 3.1 Bootstrap

```sh
ssh spark-5208
git clone https://github.com/SharathSPhD/neo-fm.git
cd neo-fm

# Bootstrap writes infra/.env.dgx, builds the compose images,
# and downloads HeartMuLa-OSS-3B + HeartCodec weights via
# scripts/download-heartmula.py.
bash scripts/dgx-bootstrap.sh
```

The bootstrap script is idempotent. Re-run it after any pull that
touches `services/*/Dockerfile`, `infra/docker-compose.dgx.yml`, or
the weights download script.

### 3.2 Start the full DGX stack

```sh
docker compose \
  -f infra/docker-compose.dgx.yml \
  --env-file infra/.env.dgx \
  --profile vocal --profile monitoring \
  up -d
```

The compose profiles split as follows:

- (no profile) -- `music-inference`, `dgx-worker`
- `vocal`      -- `vocal-synth` (kenpath/svara-tts-v1 +
  ai4bharat/indic-parler-tts)
- `monitoring` -- `prometheus`, `grafana`

### 3.3 Verify

```sh
curl -sS http://127.0.0.1:8000/healthz | jq    # music-inference
curl -sS http://127.0.0.1:8089/healthz | jq    # vocal-synth
curl -sS http://127.0.0.1:9101/metrics | head  # dgx-worker exporter
docker compose -f infra/docker-compose.dgx.yml logs --tail=50 dgx-worker
```

If any healthz fails, the corresponding `/metrics` will also fail.
The expected boot order is `music-inference` -> `vocal-synth` ->
`dgx-worker`. The worker waits for pgmq to be reachable and for both
inference services to report ready before pulling its first message.

### 3.4 Governor

```sh
python3 scripts/neo-fm-governor.py status
python3 scripts/neo-fm-governor.py pause --reason "drain for kernel update"
python3 scripts/neo-fm-governor.py drain --deadline-seconds 180
python3 scripts/neo-fm-governor.py resume
```

ADR 0011 §6 names the three test gates that have to stay green
(`drain-respects-in-flight`, `drain-deadline-SIGTERM`,
`preempted-taxonomy`).

### 3.5 Re-capture demo audio (optional)

```sh
export MUSIC_INFERENCE_URL=http://localhost:8000
scripts/build-demo.sh phase-1
scripts/build-demo.sh phase-2
scripts/build-demo.sh phase-3
git add demos/phase-{1,2,3}.wav
git commit -m "demos: refresh"
```

---

## 4. Production (Vercel)

Vercel is wired to the GitHub repo. Each push to `main` builds and
auto-promotes. Vercel env vars (Project Settings -> Environment
Variables) mirror the local `.env.example` plus:

| Variable | Scope | Why |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | all | public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all | public |
| `SUPABASE_SERVICE_ROLE_KEY` | Production + Preview | server-only |
| `NEO_FM_INTERNAL_HMAC_SECRET` | Production + Preview | server-only |
| `UPSTASH_REDIS_REST_URL` | Production + Preview | optional, durable rate limit |
| `UPSTASH_REDIS_REST_TOKEN` | Production + Preview | as above |
| `HF_TOKEN` | Production + Preview | cover-art HF inference |
| `NEXT_PUBLIC_APP_URL` | Production | absolute share URLs |

**Deployment Protection** under Vercel Project Settings:

- Production: **Standard Protection** OFF (the share URLs / OG /
  embed routes must work for anonymous visitors).
- Preview: **Standard Protection** ON or limited by allowlist.

If protection is on and you click the email confirmation link, you
will land on the Vercel SSO challenge instead of the app. Sprint C
(a) handled the on-app redirect logic; protection ON is a separate
config-level issue you fix in the dashboard.

---

## 5. Smoke-test matrix

Per environment, the smoke set you should run after any push:

| Env | Step | Command |
| --- | --- | --- |
| local | typecheck | `pnpm --filter=@neo-fm/web typecheck` |
| local | unit tests | `pnpm --filter=@neo-fm/web test -- --run` |
| local | lint | `pnpm --filter=@neo-fm/web lint` |
| local | python worker | `cd services/dgx-worker && uv run pytest` |
| local | python music | `cd services/music-inference && uv run pytest` |
| local | python vocal | `cd services/vocal-synth && uv run pytest` |
| local | healthz | `curl -sS localhost:3000/api/health \| jq` |
| dgx | health | `curl -sS localhost:8000/healthz; curl -sS localhost:8089/healthz` |
| dgx | metrics | `curl -sS localhost:9101/metrics \| head` |
| prod | health | `curl -sS https://neo-fm.vercel.app/api/health \| jq` |
| prod | smoke | sign in -> create song -> see Realtime tick -> play audio |

---

## 6. Common bootstrap failures

- **"DGX worker says queue_unreachable"** -- the `neo_fm_worker`
  role's password (in `infra/.env.dgx`) has rotated. Reset it via
  `alter role neo_fm_worker with password '...'` and re-run
  `bash scripts/dgx-bootstrap.sh`.
- **"Supabase MCP `execute_sql` returns permission denied"** -- you
  ran a destructive statement as the publishable client. Use
  `apply_migration` (service role) or the dashboard SQL editor.
- **"`UPSTASH_REDIS_REST_URL` is set but health says degraded"** --
  Upstash REST tokens default to read-only. Mint a read+write token.
- **"Vercel preview shows blank /s/<publicId>"** -- preview has
  deployment protection on. Either turn it off or share the
  ?_vercel_share token.

---

## 7. Beyond v1.1

`docs/PRODUCTION-MIGRATION.md` covers the path from "single DGX +
Supabase managed" to a production AWS footprint (EKS + RDS +
ElastiCache + S3 + ALB). It uses awspricing-backed cost tables, so
re-run the script after any AWS price update.
