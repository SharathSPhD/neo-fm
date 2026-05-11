# Phase 4 handoff — external resources required

Status as of this commit:

- Phases 0, 2 are merged to `main` and fully verified by automated tests.
- Phases 1, 3 are merged to `main` for everything that can be verified
  offline. The DGX-bound WAV demos (`demos/phase-1.wav`, `demos/phase-3.wav`)
  are deferred to operator bring-up — see the respective `SMOKE-HANDOFF.md`.
- Phase 4 cannot start in the repo alone: it depends on a real Supabase
  project, a real Vercel link, and several secrets that the agent has no
  authority to provision. **This document is the contract** between the
  agent and the operator. When all items below are done, the agent can
  resume on `phase/4a-supabase-schema`, `phase/4b-cloud-api`, and
  `phase/4c-dgx-worker` (parallel worktrees per
  [`docs/IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md#phase-4)).

Treat every checkbox as a hard blocker. None of them have a sensible
agent-side default. If you stub them, you will burn the Ralph-Wiggum gate
("real over fake") and the platform will silently regress to a demo
instead of a product.

---

## 0. Lingering Phase 1-3 blockers (DGX bring-up)

These are operator-side prerequisites that block the WAV demos
(`demos/phase-1.wav`, `demos/phase-2.wav`, `demos/phase-3.wav`). Phase 4
does not technically require them, but the Ralph-Wiggum gate for Phases
1–3 only fully closes once they are done. Detailed steps:

- [ ] [`demos/phase-1-SMOKE-HANDOFF.md`](../demos/phase-1-SMOKE-HANDOFF.md) — DGX mounts, HeartMuLa weights, HF_TOKEN, `infra/.env.dgx`.
- [ ] [`demos/phase-2-SMOKE-HANDOFF.md`](../demos/phase-2-SMOKE-HANDOFF.md) — Phase 1 reused; then `scripts/build-demo.sh phase-2`.
- [ ] [`demos/phase-3-SMOKE-HANDOFF.md`](../demos/phase-3-SMOKE-HANDOFF.md) — Phase 1 reused; then `scripts/build-demo.sh phase-3`.

When complete, commit the resulting WAVs + `nvidia-smi` snapshot under
`demos/` and update the implementation-plan checkboxes.

---

## 1. Supabase project (Phase 4a + 4b + 4c)

The whole cloud half of the platform runs on one Supabase project. The
agent cannot create this; it requires a real email, a billing decision,
and a region choice with legal/latency implications.

### 1.1 Create the project

- [ ] Sign in / sign up at <https://supabase.com>.
- [ ] Create a new project. Region: **`ap-south-1` (Mumbai)** unless you
      have an explicit reason to deviate — Indian users are the wedge
      persona per `PRD.md`.
- [ ] Choose the smallest paid tier that allows non-trivial connection
      pooling and Storage egress (Free tier hibernates and rate-limits
      Storage — fine for early prototyping, painful for any real demo).
- [ ] Save the project ref (the short slug Supabase shows in the URL,
      e.g. `xqofzbqpgkfvxxxxxx`).

### 1.2 Capture credentials (these never leave your machine until you
trust GitHub Actions secrets / Vercel env settings)

- [ ] `SUPABASE_URL` — `https://<project-ref>.supabase.co`.
- [ ] `SUPABASE_ANON_KEY` — public; goes in browser + Next.js client.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — server-side only; gives full bypass
      of RLS. Never paste this into a client bundle, a Discord, or a
      paste service. The Phase 4b API route handlers and the Phase 4c
      worker both need it.
- [ ] `SUPABASE_JWT_SECRET` — for verifying tokens in the dgx-worker
      (which doesn't have a direct Supabase client). Available in
      `Settings → API → JWT Settings`.
- [ ] `SUPABASE_DB_URL` — the Postgres connection string (transaction
      pooler form, `6543`). Needed by the dgx-worker for direct pgmq
      access per ADR 0004.

### 1.3 Install the Supabase CLI

- [ ] `brew install supabase/tap/supabase` (macOS) or
      `npx supabase --version` (works everywhere but slower).
- [ ] `supabase login` once; this writes `~/.supabase/access-token`.
- [ ] `supabase link --project-ref <project-ref>` from the repo root.
      This creates `supabase/.temp/project-ref` which is gitignored.

### 1.4 Verify pgmq is available

Supabase enables `pg_net`, `pgvector`, etc. by default, but `pgmq` is
opt-in. From the SQL editor:

```sql
create extension if not exists pgmq;
```

If the extension is unavailable on your tier, escalate to Supabase
support before continuing — every migration in Phase 4a assumes pgmq.

---

## 2. Vercel project (Phase 4b + Phase 5)

The Next.js cloud API and the Phase 5 web UI ship to Vercel. Same
pattern as Supabase: the agent cannot create the project, and stubbing
it would route every signup at a 404.

- [ ] Sign in at <https://vercel.com>.
- [ ] Create a new project, import the GitHub repo
      `SharathSPhD/neo-fm`, pick the `apps/web` directory as the root.
- [ ] Configure framework preset: Next.js 14 (App Router).
- [ ] Install the **Supabase Vercel integration** (it auto-wires the
      env vars below into Preview + Production environments).
- [ ] Confirm the following env vars are set in `Project Settings → Env`:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (Production only — do NOT add to Preview if
    you don't want PR previews to mutate your prod DB)
- [ ] Add `MUSIC_INFERENCE_HMAC_SECRET` (server-side only). Same value as
      `infra/.env.dgx`.
- [ ] Domain: optional for v1. If you have one, point its DNS at Vercel
      and add it under `Domains`. Otherwise the `*.vercel.app` URL is
      acceptable until launch.

---

## 3. GitHub Actions scope (Phase 4 onward CI)

The agent has been editing workflow files via `StrReplace`, which the
local Cursor hook gates on every change. Several CI jobs need GitHub
Actions secrets that only the operator can paste.

In `Settings → Secrets and variables → Actions → New repository secret`:

- [ ] `SUPABASE_PROJECT_REF` — for `supabase db push` from CI.
- [ ] `SUPABASE_DB_PASSWORD` — for the same. Generated when you create
      the project.
- [ ] `SUPABASE_ACCESS_TOKEN` — same as `~/.supabase/access-token`.
- [ ] `MUSIC_INFERENCE_HMAC_SECRET` — only needed if CI smokes the DGX
      path; not required for the v1 launch.
- [ ] `VERCEL_TOKEN` — only if you want CI to deploy production builds
      instead of letting the Vercel git integration do it. Optional.

Workflow permissions:

- [ ] Confirm `Settings → Actions → General → Workflow permissions` is set
      to **Read and write permissions** (needed for the docker-build
      workflow to push SBOMs back to the PR).
- [ ] `Allow GitHub Actions to create and approve pull requests`: leave
      OFF unless you intentionally want bot-authored PRs.

---

## 4. Tailscale / network (Phase 4c)

The dgx-worker calls `music-inference` over Tailscale. The agent has
implemented this end (HMAC headers, internal URL via env). The operator
must:

- [ ] Verify `tailscale up --advertise-tags=tag:neo-fm-dgx` on the DGX
      machine, with the Tailscale ACL allowing the worker container
      group to reach the music-inference container group on port 8000.
- [ ] Note the DGX Tailscale name (e.g. `dgx-1.taila7c2c.ts.net`). This
      is the `MUSIC_INFERENCE_URL` value the worker uses.

---

## 5. Observability sinks (Phase 4 and forward)

Phase 11 makes observability formal, but Phase 4 already starts emitting
JSON logs and Prometheus-style metrics. Until Phase 11 lands, the
operator can point them at any sink they have:

- [ ] (Optional but recommended) Provision a Grafana Cloud free tier:
      <https://grafana.com>. Capture `GRAFANA_CLOUD_API_URL` and
      `GRAFANA_CLOUD_PROMETHEUS_USER` / `_PASSWORD` for later.
- [ ] (Optional) Provision a Loki endpoint for log shipping. The same
      Grafana Cloud account covers this.

Until these exist, the worker/inference services log to stdout and the
operator can `docker logs` to inspect. That is acceptable for Phases
4–10.

---

## 6. Email (Phase 9, not Phase 4)

Phase 9's email notifications need an SMTP/API provider. The agent
will design the Edge Function around Resend (cheap, no DKIM ceremony)
but the operator must:

- [ ] Sign up at <https://resend.com>.
- [ ] Verify a sending domain (`@neo-fm.com` if you have it; otherwise a
      subdomain of any domain you control).
- [ ] Capture `RESEND_API_KEY` and store it as a Supabase Edge Function
      secret: `supabase secrets set RESEND_API_KEY=...`.

This is **not** a Phase 4 blocker; documented here so it doesn't surprise
you later.

---

## 7. Sanity checklist before unblocking the agent

The agent will pick up on `phase/4a-supabase-schema` once the following
are true. Do not start the worktree branch until every box is ticked, or
the agent will burn the Ralph-Wiggum reproducibility criterion on a
half-provisioned environment.

- [ ] `supabase link --project-ref <ref>` succeeds.
- [ ] `psql "$SUPABASE_DB_URL" -c "select 1"` succeeds.
- [ ] `psql "$SUPABASE_DB_URL" -c "create extension if not exists pgmq; select pgmq.list_queues();"`
      succeeds (the table can be empty).
- [ ] `vercel link` succeeds and `vercel env ls preview` shows the
      Supabase vars.
- [ ] `tailscale status | grep -q dgx` from the worker host (or wherever
      Phase 4c will run).
- [ ] The agent has been told, plainly, which environment it is acting
      against: dev, preview, or production. Phase 4 migrations are
      destructive on first run — never let the agent guess.

When you're ready, point the agent at this document and say "Phase 4
is unblocked; proceed." It will resume on `phase/4a-supabase-schema`,
land the migrations, then on `phase/4b-cloud-api` and
`phase/4c-dgx-worker`, both gated by the items above.
