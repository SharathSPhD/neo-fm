# Production cutover runbook (neo-fm v2 → neo-fm.com)

Prod backend: Supabase project **neo-fm-prod** (`kgxltxvjlsnbwomklwox`, ap-south-1). Old prod (project `neo-fm`, paused) is not migrated.

## Stage 0 — done
- [x] neo-fm-prod created; migrations 0001–0057 applied (0001–0008 via MCP, 0009–0057 via `infra/supabase/prod-bootstrap/part*.sql` run in the SQL editor — the MCP cannot run DROP). Verified: 25 public tables, buckets tracks/cover-art/voice-samples, 40 policies, signup trigger, tiers incl. developer, live pipeline config, advisors INFO/WARN only.
- [x] Rehearsal wiring: preview env of branch claude/sleepy-keller-8eiz4s now points at neo-fm-prod (URL + publishable key + service role).
- Note: migration 0029's job-complete email trigger still points at the OLD project's edge function URL; repoint before enabling email notifications.
- [x] Embedder on Cloud Run (EmbeddingGemma), Stripe test products/prices, Google OAuth client.

## Stage 1 — you (5 min)
1. **Vercel → neo-fm-web → Settings → Environment Variables → add (Production + a Preview scoped to branch `release-v2`):**
   - `SUPABASE_SERVICE_ROLE_KEY` = neo-fm-prod service_role key (Supabase → Project Settings → API → *Secret keys / service_role*). **Mark Sensitive. Never paste in chat.**
2. **Supabase neo-fm-prod → Authentication → Providers → Google**: enable; paste the Google client ID + secret.
   In Google Cloud, add redirect URI `https://kgxltxvjlsnbwomklwox.supabase.co/auth/v1/callback` to the OAuth client.
   **Uncheck "Designate this client for AI agents / MCP"** on that OAuth client: it is a normal web sign-in client (Google advises separate clients for agent flows).
3. **Supabase neo-fm-prod → Authentication → URL Configuration**: Site URL `https://neo-fm.com`; redirect allow-list `https://neo-fm.com/**`, `https://*.vercel.app/**`.

## Stage 2 — me (pre-production rehearsal, no domain yet)
- Branch `release-v2` + Preview env vars (branch-scoped) pointing at neo-fm-prod; run the full Playwright suite incl. the slow create-song journey, Google redirect check, Stripe test checkout.
- Run `ma-setup?upgrade=1` against the prod stack, seed 10 showcase songs (published) via the real pipeline.

## Stage 3 — cutover (≈30 min, reversible until step 5)
1. Lower DNS TTL at GoDaddy to 300 s (24 h before ideally).
2. Merge `claude/sleepy-keller-8eiz4s` → `main` (production branch) after CI green.
3. Replace Production env vars: remove the old Supabase-integration vars (`POSTGRES_*`, `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`) and set the neo-fm-prod values; set `NEXT_PUBLIC_APP_URL=https://neo-fm.com`, Stripe **test** keys stay until live review.
4. Add `neo-fm.com` + `www.neo-fm.com` to the Vercel project (I do this); you set GoDaddy nameservers → `ns1.vercel-dns.com` / `ns2.vercel-dns.com`.
5. Stripe webhook endpoint → `https://neo-fm.com/api/billing/webhook` (I create it; the signing secret goes straight into Vercel, never into chat).
6. Smoke: Playwright suite against `https://neo-fm.com`; production cron (`* * * * *`) active; spend ceilings set (`LYRIA_BUDGET_GBP` monthly).
7. Rollback: re-point the domain to the previous deployment / restore old env vars (old Supabase project is only paused).

## Before real traffic
- Remove dev-only items: `dev_autoconfirm_signups` trigger (dev DB only), `AGENT_TICK_SECRET`, test users, showcase@example.com.
- Counsel review of /privacy and /terms; DPDP deletion/export flow; per-IP rate limits.
- Stripe live mode only after an Indian-card recurring test (RBI e-mandate).

## Pinned providers (update deliberately, never via "latest")
- Embedder: EmbeddingGemma-300M (Cloud Run), Gemini QA transcriber: `gemini-3.8-flash` (`GEMINI_QA_MODEL` overrides; `gemini-2.5-flash` is closed to new users), Lyria: `lyria-3-clip-preview` / `lyria-3.5`.
