# neo-fm Security

> Stable reference doc that lists every trust boundary, secret, RLS
> policy, and outstanding security finding for v1.1. Detailed
> per-decision rationale lives under `docs/DECISIONS/` (most recently
> [ADR 0021][adr21]).

[adr21]: DECISIONS/0021-security-definer-review.md

Last revised: v1.1 deep-dive, Sprint J. Linked to advisor sweep from
2026-05-16.

## 1. Trust boundaries

```mermaid
flowchart LR
  internet["Public internet"] -->|HTTPS + cookies| vercel["Vercel edge<br/>(neo-fm web)"]
  vercel -->|HTTPS + cookies| sbAuth["Supabase Auth"]
  vercel -->|HTTPS (SDK + service role)| sbDb["Supabase Postgres"]
  vercel -->|signed URL POST/GET| sbStor["Supabase Storage"]
  sbDb -.->|pgmq REST| tailnet["Tailscale tailnet"]
  tailnet -->|HMAC| dgx["DGX Spark"]
```

What crosses each boundary:

| Boundary | What flows | Who can read |
| --- | --- | --- |
| Internet -> Vercel | Auth cookies, REST bodies, OG/embed reads | Vercel edge + Supabase Auth |
| Vercel -> Supabase | User JWT (SSR client) + service-role for narrow paths | Supabase |
| Vercel -> Supabase Storage | Signed URLs (15 min TTL) | Bucket policies |
| Supabase -> DGX | pgmq messages (queue body is `{ job_id, song_doc }`) | `neo_fm_worker` role only |
| DGX internal | HMAC over `NEO_FM_INTERNAL_HMAC_SECRET` | Same-host services |

## 2. Secrets inventory

All secrets are version-controlled **by reference only**; the actual
values live in Vercel env, Supabase env, and `infra/.env.dgx`
(gitignored). The canonical list is below; rotate any of these the
same way you'd rotate a password.

| Secret | Where it lives | Owner | Rotation cadence |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel, .env.local | web | never (project URL) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_*`) | Vercel, .env.local | web | when leaked |
| `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_*`) | Vercel (server-only) | platform | 90 days or on incident |
| `NEO_FM_INTERNAL_HMAC_SECRET` | Vercel + infra/.env.dgx | dgx | 180 days |
| `neo_fm_worker` Postgres password | infra/.env.dgx | dgx | 180 days |
| `HF_TOKEN` | Vercel | dgx | 365 days |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel | web | 90 days |
| `NEO_FM_RESEND_API_KEY` | Supabase Edge env | platform | 180 days |
| Supabase project DB password | Supabase dashboard | platform | only on incident |

If a Vercel deploy is ever attached to a public preview branch with
`SUPABASE_SERVICE_ROLE_KEY`, **rotate immediately** in the Supabase
dashboard (`Project Settings -> API -> Roll keys`). The publishable
key is safe to expose; the service-role key is not.

## 3. AuthN + AuthZ

- **Email + password** via Supabase Auth. Sign-up generates a
  confirmation email; the link points at `<APP_URL>/auth/callback`
  with a one-time code. The callback exchanges it for a session and
  redirects into the app. ADR 0019 covers the lifecycle.
- **Leaked password protection**: enabled in the dashboard under
  `Authentication -> Policies -> Password security` (closes the
  `auth_leaked_password_protection` advisor warning).
- **Session refresh**: middleware touches the Supabase session on
  every non-asset request so RSC reads always see a fresh JWT.
- **RLS** is enforced on every public table. Direct INSERT/UPDATE
  on `jobs` is revoked from `authenticated`; `create_song_job` and
  `create_section_regen_job` are the only paths.
- **Service-role** is used by Vercel only for:
  - waitlist read (admin email list export, behind manual auth)
  - account delete (calls `admin.deleteUser` then lets cascade run)
  - cover-art and stems writes to S3-compatible storage
  - orphan-reconciler edge function
- **HMAC** is used between Vercel <-> DGX (only `dgx-worker`
  imports it; nothing in Vercel currently dials the DGX) and
  between DGX internal services.

## 4. RLS map (summary)

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `users` | self + public_handle | self (via auth trigger) | self | n/a (cascade from auth.users) |
| `jobs` | self | RPC only | self (limited cols) | self |
| `song_documents` | via jobs | RPC only | via jobs | cascade |
| `tracks` | via jobs | worker role | worker role | cascade |
| `track_stems` | via jobs | worker role | worker role | cascade |
| `cover_art` | via jobs | worker role + RPC | self | cascade |
| `published_songs` | anon (public read) | RPC `publish_song` | self via RPC | self |
| `song_likes` | anon (count) | self | n/a | self |
| `follows` | anon (count) | self | n/a | self |
| `song_reports` | service role only | anon (reporter_id null) + authed (reporter_id = auth.uid()) | service role | n/a |
| `feedback` | service role only | RPC `submit_feedback` (anon + authed) | service role | service role |
| `waitlist` | service role only | RPC `join_waitlist` (anon + authed) | service role | service role |
| `pgmq.q_song_jobs` | `neo_fm_worker` only | service role + RPC | `neo_fm_worker` only | `neo_fm_worker` only |

## 5. HTTP hardening

Every response goes through `middleware.ts -> applySecurityHeaders`,
which sets:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: <opt-out for every powerful API>`
- `Cross-Origin-Opener-Policy: same-origin`
- `Content-Security-Policy:` route-aware (see below)
- `X-Frame-Options: DENY` (except `/embed/*` which gets
  `frame-ancestors *`)

Per-IP rate limits (per minute, fixed window):

| Bucket | Limit | Routes |
| --- | --- | --- |
| `songs:create` | 6 | `POST /api/songs` |
| `songs:regen` | 6 | section regenerate |
| `songs:publish` | 30 | publish toggle |
| `songs:gen-aux` | 6 | cover-art, variation |
| `anon:feedback` | 6 | `POST /api/feedback` |
| `anon:waitlist` | 10 | `POST /api/waitlist` |
| `public:read` | 120 | `/api/p/*` |
| `api:default` | 60 | everything else |

Backed by Upstash Redis when configured, in-memory fallback
otherwise (single-instance only).

## 6. Outstanding security findings (advisor)

Run via Supabase MCP: `get_advisors type=security`. After the v1.1
sweep + migration 0027:

| Finding | Severity | Status | Why |
| --- | --- | --- | --- |
| `security_definer_view` (recent_vocal_quality, public_profiles) | ERROR | RESOLVED in 0027 | Both views recreated as SECURITY INVOKER. |
| `rls_policy_always_true` on song_reports INSERT | WARN | RESOLVED in 0027 | Policy split anon (reporter_id null) / authed (reporter_id = auth.uid()). |
| `auth_leaked_password_protection` | WARN | RESOLVED (manual) | Toggle enabled in dashboard. |
| `anon_security_definer_function_executable` (submit_feedback, join_waitlist) | WARN | ACCEPTED, documented | These functions are the only path for anon writes. ADR 0021. |
| `anon_security_definer_function_executable` (validate_handle) | WARN | RESOLVED in 0027 | EXECUTE revoked from anon and authenticated; it is a trigger function. |
| `authenticated_security_definer_function_executable` (create_song_job, create_section_regen_job, publish_song, recover_song_job, submit_feedback, join_waitlist) | WARN | ACCEPTED, documented | All are the only write path for the user; ADR 0021. |

The "ACCEPTED" rows will keep appearing on every advisor sweep --
that is the linter doing its job. The `COMMENT ON FUNCTION` strings
added in migration 0027 document the intent for future reviewers.

## 7. Incident response

Lightweight v1.1 process; expand in `docs/RUNBOOK.md` if/when we
have a second on-call body.

1. **Secret leak**: rotate at source first, then audit usage. If
   the leaked value was `SUPABASE_SERVICE_ROLE_KEY`, roll it in the
   Supabase dashboard, then redeploy Vercel.
2. **Storage path traversal / signed-URL abuse**: shorten the
   storage TTL to 5 min in `lib/supabase/storage.ts` and ship a
   patch.
3. **RLS regression**: every migration goes through the agent +
   the Supabase MCP `get_advisors` sweep at the end of the sprint.
   If a regression slips through, the orphan-reconciler will keep
   the data plane consistent while a follow-up migration is
   prepared.
4. **DGX compromise**: revoke `neo_fm_worker` role; the worker
   stops being able to write tracks but the user-facing app keeps
   running off the historical data. Re-image the DGX from the
   reproducibility doc before reissuing credentials.
5. **Account takeover via password compromise**: leaked-password
   protection blocks the obvious vector; for residual cases users
   can reset via the `/account` page.

## 8. Privacy posture

- We store: email, hashed password (Supabase managed), handle,
  song documents (JSON), generated audio, likes/follows.
- We do not store: payment info (no Stripe yet), phone numbers,
  IP-level geolocation, browser fingerprints.
- Account deletion (`DELETE /api/account`) calls
  `admin.deleteUser`; everything cascades. Currently this also
  removes published songs from `/discover` -- v1.2 plans to
  re-parent them to a sentinel "deleted_user" account so share
  URLs survive (tracked in ADR 0021 follow-ups).
- Data export (`GET /api/account/export`) returns a single JSON
  with the user's profile, song documents, and metadata. Audio
  binaries are referenced as signed URLs in the export and are
  retrievable for 15 minutes after the export.

## 9. Compliance flags

| Regime | Status |
| --- | --- |
| GDPR (EU) | Subject access + deletion via `/account`. Data residency NOT in-EU; v1.1 is ap-south-1 only. |
| DPDP Act (India) | Data residency in ap-south-1 satisfied via Supabase managed. Notice-and-consent banner not yet implemented (v1.2). |
| SOC 2 | Out of scope for v1.1. Supabase is SOC 2 Type II; Vercel is SOC 2 Type II. Our own controls are not audited. |
| PCI | N/A (no payment data). |
| HIPAA | N/A (no PHI). |
