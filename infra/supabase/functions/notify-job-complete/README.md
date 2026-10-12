# notify-job-complete

Supabase Edge Function that emails the song owner when their generation
job completes. Sprint 4 (M4 launch readiness).

## Wiring

Durable path (migration 0043): a trigger on `public.jobs` enqueues a
message on the pgmq `email_notifications` queue when a job reaches
`completed` or `failed`. This function drains the queue (cron every 2
minutes, see `schedule.json`) and archives a message only after Resend
accepts it.

Fast path (migration 0029, repointed by 0065): a pg_net call from the
`notify_job_complete` trigger nudges this function right after a job
completes so the drain does not wait for the cron. It is a no-op until
the vault secret `neo_fm_webhook_secret` exists. The target URL is the
vault secret `neo_fm_notify_url`, defaulting to neo-fm-prod.

Without `RESEND_API_KEY` the function returns 200 `{skipped:"no_resend_key"}`
and leaves the queue untouched. Messages older than 24 h are archived
unsent so adding the key later does not email people about old songs.

The email is written in the song's language (en, hi, ta, te, kn, bn;
anything else falls back to English).

## Required env (set on the Supabase project secrets):

| Variable                    | Required           | Notes                                              |
| --------------------------- | ------------------ | -------------------------------------------------- |
| `RESEND_API_KEY`            | yes (in prod)      | When unset, the function is a no-op (queue untouched). |
| `RESEND_FROM`               | no                 | Defaults to `neo-fm <noreply@neo-fm.app>`.         |
| `NEO_FM_PUBLIC_APP_URL`     | yes                | e.g. `https://neo-fm.app`. Used in the email link. |
| `SUPABASE_URL`              | auto               | Provided by the Supabase runtime.                  |
| `SUPABASE_SERVICE_ROLE_KEY` | auto               | Provided by the Supabase runtime.                  |
| `NEO_FM_WEBHOOK_SECRET`     | yes (recommended)  | Shared secret echoed back as `x-webhook-secret`.    |

## Deploy

```bash
supabase functions deploy notify-job-complete \
  --project-ref <project> --no-verify-jwt
```

`--no-verify-jwt` because the webhook caller doesn't carry a user JWT
— authorization is via `x-webhook-secret` instead.

## Local testing

```bash
supabase functions serve notify-job-complete --no-verify-jwt
curl -X POST http://localhost:54321/functions/v1/notify-job-complete \
  -H 'content-type: application/json' \
  -H 'x-webhook-secret: dev-secret' \
  -d '{"type":"UPDATE","schema":"public","table":"jobs",
       "record":{"id":"<job-uuid>","user_id":"<user-uuid>","status":"completed"},
       "old_record":{"status":"processing"}}'
```
