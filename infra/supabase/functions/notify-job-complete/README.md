# notify-job-complete

Supabase Edge Function that emails the song owner when their generation
job completes. Sprint 4 (M4 launch readiness).

## Wiring

This function is invoked by a **Supabase Database Webhook**:

- Source: `public.jobs` UPDATE
- HTTP method: POST
- URL: `https://<project>.functions.supabase.co/notify-job-complete`
- Header: `x-webhook-secret: <NEO_FM_WEBHOOK_SECRET>`

The function self-filters: it only sends when
`record.status = "completed"` and `old_record.status <> "completed"`,
so re-deliveries from the webhook layer are idempotent.

## Required env (set on the Supabase project secrets):

| Variable                    | Required           | Notes                                              |
| --------------------------- | ------------------ | -------------------------------------------------- |
| `RESEND_API_KEY`            | yes (in prod)      | When unset, function logs intent and returns 204.  |
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
