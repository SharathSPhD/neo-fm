# neo-fm threat model

Scope: Next.js app (Vercel), Supabase `neo-fm-prod`, Claude Managed Agents pipeline, embedder (Cloud Run), Stripe. Written 2026-10-12 from the code on `main` and a read-only inspection of the live Supabase projects (grants, policies, advisors). No secrets are recorded here.

## Assets and trust boundaries

| Asset | Where | Who may touch it |
|---|---|---|
| User PII (email, name, tier) | `public.users`, `auth.users` | owner, service role |
| Billing state | `user_billing`, `subscriptions`, Stripe | service role (webhook), owner read |
| Spend budget (Lyria, Claude) | `spend_ledger`, `user_spend`, agent pipeline | service role only |
| Master secrets (`EMBED_TOKEN`, `CRON_SECRET`, `AGENT_TICK_SECRET`, service key) | Vercel env | server only; never enter a sandbox |
| Unpublished songs/lyrics | `jobs`, `tracks`, `song_documents`, storage | owner |

Boundaries: browser (untrusted) -> Next.js API -> Supabase (RLS) ; Next.js -> Managed Agents sandbox (runs model-written code, treats briefs as untrusted) ; sandbox -> embedder (scoped token only).

## Threats

### T-PI: prompt injection through user briefs into the agent sandbox
Path: `POST /api/songs` -> `screenRequest` (moderation) -> `metadata.prompt` -> `briefText()` -> agent. The agent has bash, file write, `generate_music`, and (pro tier) `web_fetch`/`web_search`.
Controls: moderation before spend and again on the agent's lyrics before Lyria; `generate_music` is a host-side custom tool (host enforces safety, spend, call count); free/worker agents have web tools disabled; sandbox networking is `limited` to package managers plus the embedder host; master secrets never enter the sandbox.
Gaps:
- **T-PI-1 (Low, fixed here):** the brief was interpolated raw as the first line of the outcome description. A multi-line brief could forge `Engine mode` / `EMBED_URL=` / `EMBED_TOKEN=` lines or start new instruction blocks. Now flattened to one line, capped at 1000 chars, JSON-quoted and labelled as untrusted data. (`apps/web/lib/agent/runner.ts`: needs lead review.)
- **T-PI-2 (Medium, fixed in follow-up PR, issue #39: pro `web_fetch` disabled, `web_search` kept):** pro agents have `web_fetch`, which is not bound by sandbox `networking`. An injected instruction can send anything in the sandbox (the scoped embed token, the brief, lyrics) to an arbitrary URL. Impact is bounded because only the scoped token is present, but it is a free exfiltration channel and an indirect-injection path (fetched pages). Options: drop `web_fetch` for pro, or allowlist domains.
- **T-PI-3 (Low, issue):** `pip`/package-manager access in the sandbox allows installing arbitrary packages. Accepted for the cascade; revisit if egress controls are added.

### T-SSRF: EMBED_URL
`EMBED_URL` is an operator-set Vercel env var, never user input; the web app does not fetch it with user-influenced data. It is passed to the agent and, via `ma-setup`, becomes the single allowed sandbox host. Residual risk: a mis-set value (e.g. an internal host) is trusted by the agent. **T-SSRF-1 (Low, issue):** validate `EMBED_URL` at use (https only, no private/link-local IPs) in `ma-setup` and `process.ts`. The Python client (`http_embed.py`) uses `urllib` with `# noqa: S310`; it accepts `file://`/`http://` if the env were poisoned. Same fix class.

### T-TOK: token minting scope
`mintEmbedToken` = `v1.<exp>.<HMAC-SHA256(master, "v1.<exp>")>`, verified in constant time by the embedder. Good: master never enters a sandbox, tokens expire (30 min default, 60 min in pce-eval), embedder exposes only `/embed` and `/health`.
Gaps: **T-TOK-1 (Low, issue):** token is not bound to a job or user, so a leaked token is usable by anyone until expiry (embedding compute cost only). Bind a job id into the signed payload. **T-TOK-2 (Low):** the admin routes accept `CRON_SECRET` or `AGENT_TICK_SECRET` as a bearer with the same power (`ma-setup`, `stripe-setup`, `q`, `self-improve`...); `CRON_SECRET` is also on Vercel's cron path. Consider a separate admin secret and rate limits. `checkBearer` itself is timing-safe.

### T-RLS: row-level security review
All 26 public tables have RLS enabled in prod. Policy review:
- Ownership policies (`jobs`, `tracks`, `song_documents`, `cover_art*`, `track_stems`, `user_presets`, `consents`, `taste_profiles`, `feedback_events`, `subscriptions`, `user_billing`, `preference_pairs`) key on `auth.uid()` correctly. Public-song reads require `published_visibility in (public, unlisted)` and a `public_id`.
- Tables with RLS and no policy (`agent_runs`, `spend_ledger`, `user_spend`, `config_versions`, `eval_*`, `job_*`) are deny-all for client roles, which is intended (service role only; advisor level INFO).
- `jobs`/`subscriptions` have broad column grants to `anon`/`authenticated` but no UPDATE/INSERT policies, so writes are denied. Defence in depth: revoke the grants (issue).
- `SECURITY DEFINER` RPCs all set `search_path` and are not executable by anon except `join_waitlist` and `submit_feedback` (intended; both are rate-limit candidates).
Findings:
- **T-RLS-1 (High, fixed here, migration 0070):** `users_select_public_handle` exposes every row with a handle, and prod has default column grants, so `anon` could `GET /rest/v1/users?select=email,tier,name,locale,agent_plan`. Migration 0027 assumed column grants limited this; they do not. Fix: anon limited to `(id, handle, created_at)`.
- **T-RLS-2 (High, fixed here, migration 0070):** `users_update_self_mutable` + default UPDATE grants + a trigger that only blocks `tier` lets any signed-in user PATCH their own `agent_plan` to `pro` (`planForTier` honours it): free account gets the Sonnet+Opus pipeline and the pro spend cap (3 GBP/month vs 0.3). Fix: authenticated may only update `(handle, name, locale)`.
- **T-RLS-3 (Medium, fixed in follow-up PR, issue #38):** the same policy still lets any signed-in user read `email`, `tier`, `name`, `agent_plan` of every user with a handle. Needs a design change (public profile via a view/RPC and own-row reads via a separate path); touches `/api/me`, account pages and `shell-user.ts` so it is not a cheap fix.
- **T-RLS-4 (Low):** `cover_art_attempts_touch` has a mutable `search_path` (advisor WARN).
- **T-RLS-5 (Low):** Auth leaked-password protection is disabled (advisor WARN); toggle in the Supabase dashboard.

### Other
- Stripe webhook verifies the signature via `constructEvent`. Test-mode keys today; re-review before live keys.
- Test users in prod and CRON_SECRET rotation are already tracked by the lead.

## Verification
Migration 0070 was applied inside a rolled-back transaction on the dev Supabase project; privilege checks afterwards: anon cannot select `email`, can select `handle`; authenticated cannot update `agent_plan`/`tier`, can update `handle`; authenticated has no INSERT. Not applied to prod; the lead applies it.

## Status of findings (updated)
- Fixed: T-RLS-1, T-RLS-2 (0070), T-RLS-3 (0073), T-PI-1, T-PI-2, T-SSRF-1 (`safeEmbedUrl`), T-TOK-1 (job-bound `v2` embed tokens), T-TOK-2 (opt-in `ADMIN_SECRET`; until it is set, admin routes still accept the cron/tick secrets), T-RLS-4 (search_path) and the client write-grant cleanup (0083).
- Enforced in CI by `scripts/check-migrations-security.mjs` (job `migration security lint`): every table needs RLS, every SECURITY DEFINER function needs `set search_path` and a `revoke execute ... from public|anon`, every view needs `revoke ... from anon`. New violations fail the build.
- Still open (manual): enable leaked-password protection in the Supabase dashboard (T-RLS-5); provision `ADMIN_SECRET` in Vercel; rate limits on `join_waitlist` / `submit_feedback` (tracked with the rate-limiting work); T-PI-3 (package-manager egress) accepted.

## Web and dependency hardening (2026-10-13)
- CSP: the enforced policy is unchanged (still `unsafe-inline`/`unsafe-eval` for scripts, which the current Next.js output needs). A strict nonce + `strict-dynamic` policy now ships as `Content-Security-Policy-Report-Only` with a per-request nonce (middleware sets it on the request so Next stamps its inline scripts) and reports to `POST /api/csp-report` (8 KB cap, rate limited, query strings stripped, always 204). Promote it to enforcing once reports are quiet. `frame-ancestors *` stays only on `/s/<id>/embed` and legacy `/embed/*`.
- Other headers: `X-Permitted-Cross-Domain-Policies: none`, `poweredByHeader: false`, WebP-only image optimizer.
- Dependencies: `pnpm audit` went from 87 to ~34 advisories (next 14.2.35, vitest 3, `pnpm.overrides` for postcss, vite, glob, js-yaml, brace-expansion, toml, ...). What remains high/critical: Next 14.x advisories fixed only in Next >= 15.5 (migration issue filed), and `braces@3.0.3` (no patched release; dev-only via tailwind/chokidar).
- CI: `secret scan (gitleaks)` over full history (pinned v8.21.2, `.gitleaks.toml`); Dependabot weekly grouped updates for npm, pip, docker and GitHub Actions (Next major bumps ignored until the migration).

- Next 15.5 / React 19 upgrade (issue #79): clears every Next advisory. After it, `pnpm audit` shows no critical and one high (`braces@3.0.3`, no patched release, dev-only via tailwind/chokidar).
- RLS audit (CI job `rls audit`): applies every migration to a throwaway Postgres, seeds a private row per table for user A and proves anon and signed-in user B cannot read, update, delete or insert it, on every table, view and storage bucket; also fails on a view readable by clients that is not `security_invoker` (or an unlisted public view), a client-writable view (the "revoke before grant" rule), RLS off, an everyone-policy, or a new SECURITY DEFINER function clients can execute. A new table or view must be classified in `infra/supabase/tests/rls_audit.sql`. Run locally: `RLS_AUDIT_DB_URL=postgresql://... scripts/rls-audit.sh` (disposable database). Limits: it runs on plain Postgres with a Supabase stand-in (`infra/supabase/ci/bootstrap.sql`), so real pgmq/pg_net/vault behaviour and Supabase's own storage/auth internals are not exercised; function bodies (for example a definer RPC that forgets `auth.uid()`) are not tested, only listed.
