# Handoff: security

Owner thread: "Security threat model and fixes". Written 2026-10-12. No secrets in this file.

## State
- Threat model: `docs/SECURITY-THREAT-MODEL.md` (findings, what is fixed, what is open).
- Merged: #73 (client write-grant cleanup 0083, migration security lint in CI), #78 (report-only strict nonce CSP + `/api/csp-report`, security headers, dependency audit fixes, Dependabot, gitleaks CI), #87 (Next 15.5 / React 19; audit now 0 critical, 1 high = `braces`, dev-only, no patch).
- In the lead's queue: #114 (CI job `rls audit`; PCE embedder is best-effort, so a refused v2 token or dead service falls back to the lexical embedder and the song still completes).
- Enforced CSP is still the permissive one. The strict policy ships Report-Only next to it (`lib/security-headers.ts`, `strictCsp`).

## Run and verify locally
- RLS audit (needs a disposable Postgres 15/16 and `psql`): `RLS_AUDIT_DB_URL=postgresql://postgres@localhost:5432/rls_audit scripts/rls-audit.sh`. It applies all migrations, seeds one private row per table for user A, then probes as anon and user B. A new table or view must be classified in `infra/supabase/tests/rls_audit.sql` (`rls_audit.expect`) or it fails.
- Migration lint: `node scripts/check-migrations-security.mjs`.
- Web: `cd apps/web && npx tsc --noEmit && npx vitest run`; smoke + axe: `E2E_CHROMIUM=<chromium path> node scripts/smoke-local.mjs`.
- Embedder fallback: `python3 -m pytest managed-agents/pce-engine/tests`.
- Secret scan: gitleaks job in CI (`.gitleaks.toml` holds the allowlist).

## Open risks
1. The audit runs on plain Postgres with a Supabase stand-in (`infra/supabase/ci/bootstrap.sql`), not a real stack, and does not test function bodies (a definer RPC that forgets `auth.uid()` is allowlisted, not behaviour-tested).
2. The strict CSP is report-only and nobody has reviewed the reports; enforcing it blindly could break pages. Promote only after `/api/csp-report` is quiet.
3. `ADMIN_SECRET` is unset, so admin routes still accept `CRON_SECRET` / `AGENT_TICK_SECRET` (T-TOK-2). Leaked-password protection is off in Supabase (T-RLS-5). Whether the Cloud Run embedder was rebuilt since #73 is unconfirmed; the fallback above covers it at lower lyric quality.
4. No rate limit yet on `join_waitlist` / `submit_feedback`; `braces` advisory unpatched (dev-only).

## Next 3 steps
1. Merge #114 once green; confirm the `rls audit` job runs on the next migration PR.
2. Read the CSP reports for a week, fix or allowlist what shows up, then enforce the strict policy.
3. Set `ADMIN_SECRET`, enable leaked-password protection, rebuild the embedder (operator actions), then add rate limits to the two anonymous RPCs.
