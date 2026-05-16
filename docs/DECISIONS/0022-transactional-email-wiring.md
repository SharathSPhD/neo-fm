# 0022 - Transactional email wiring (Resend)

Date: 2026-05-16
Status: Accepted (v1.2)

## Context

v1.1 shipped the Edge Function `notify-job-complete` and the local source
under [`infra/supabase/functions/notify-job-complete/index.ts`](../../infra/supabase/functions/notify-job-complete/index.ts).
It was never deployed and never wired up. Users had no notification when
their song was generated.

v1.2 wires the function for real:

1. Deploy `notify-job-complete` to the project.
2. Create a Postgres trigger on `public.jobs AFTER UPDATE` that POSTs to
   the function whenever a row transitions to `status = 'completed'`.
3. Authenticate the trigger -> function hop with a shared secret stored
   in Supabase Vault (so it never ends up in git).
4. The function uses the supplied Resend API key to send a transactional
   email containing the song's title and a deep link to `/songs/<id>`.

## Decision

### Email provider

Resend, transactional only. Picked because the function source was
already written for it and the user supplied a Resend API key. Supabase
Auth emails (signup confirm, password reset) continue to use Supabase's
built-in sender; switching those to a custom SMTP provider is deferred
to a future ADR.

### Trigger mechanism

A Postgres `AFTER UPDATE` trigger on `public.jobs` using the `pg_net`
extension's async `net.http_post(...)`. Migration
[`0029_notify_job_complete_webhook.sql`](../../infra/supabase/migrations/0029_notify_job_complete_webhook.sql)
creates the trigger and a small helper function
`public.neo_fm_webhook_secret()` that reads from
`vault.decrypted_secrets`.

Trade-offs considered:

- **Supabase Dashboard "Database Webhooks"**: not auditable in git.
  Rejected.
- **Worker-initiated HTTP call**: the worker already has the job context
  and could POST directly to the function. Would couple the worker to
  the email pipeline. Trigger keeps email wiring isolated.
- **Synchronous `extensions.http_post`**: would block the worker
  transaction on the email API. `pg_net` returns a request id
  immediately and processes the response in a background pool.

### Secret handling

The webhook secret has two homes:

1. `vault.secrets` row named `neo_fm_webhook_secret` (read by the
   trigger via `vault.decrypted_secrets`).
2. Edge Function environment variable `NEO_FM_WEBHOOK_SECRET`.

Both must match. The secret is never written to a migration file or any
git-tracked source. It is rotated by simultaneously updating the vault
row and the function env var (see Runbook).

### Sender domain

The function defaults to `neo-fm <onboarding@resend.dev>`, Resend's
shared sandbox sender. Production should set `RESEND_FROM` to a
verified custom-domain sender (e.g. `neo-fm <noreply@neo-fm.app>`).
Domain verification steps are documented in the Runbook.

## Consequences

- Job completions now generate one transactional email per user (no
  digest, no opt-out yet -- both planned for a later ADR).
- A failed Resend call surfaces in the function's logs but never
  rolls the worker transaction back; the song is delivered regardless
  of email outcome.
- Adding a second notification surface (in-app inbox, push) re-uses
  the same trigger by adding additional `net.http_post(...)` calls in
  the trigger body or refactoring to fan-out via a notification queue.

## Implementation pointers

- Trigger: [`infra/supabase/migrations/0029_notify_job_complete_webhook.sql`](../../infra/supabase/migrations/0029_notify_job_complete_webhook.sql)
- Function: [`infra/supabase/functions/notify-job-complete/index.ts`](../../infra/supabase/functions/notify-job-complete/index.ts)
- Runbook: [`docs/RUNBOOK.md#email-resend-wiring`](../RUNBOOK.md#email-resend-wiring)

## Rollout state at v1.2 merge

- Function deployed (version 1).
- Trigger live; no-ops while vault secret is unset.
- Two paths to finish the wiring (operator's choice):
  1. Paste a Supabase Personal Access Token in a follow-up question and
     this skill will set the four function secrets + vault entry via
     the Management API.
  2. Operator manually sets the four secrets in the Supabase Dashboard
     under Project Settings -> Edge Functions -> Secrets, plus the
     vault entry via the SQL Editor (snippet in RUNBOOK.md).
