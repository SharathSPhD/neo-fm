# Sprint 3 -- transactional email pipeline smoke

Captured 2026-05-16 during v1.2 Sprint 3.

## Pipeline diagram

```
public.jobs (status flips to completed)
    |
    | AFTER UPDATE trigger
    v
public.tg_notify_job_complete()
    |
    | reads vault secret
    | builds JSON payload
    | net.http_post(...)
    v
https://lsxicfgqtdxvlcivlwmd.functions.supabase.co/notify-job-complete
    |
    | validates x-webhook-secret
    | fetchUserEmail(user_id)
    | fetchSongTitle(song_id)
    | POST https://api.resend.com/emails
    v
Resend -> recipient inbox
```

## What I verified

### Auth path

| Probe | Headers | Expected | Observed |
| --- | --- | --- | --- |
| Valid `x-webhook-secret` | matching vault hex | 204 | 204 |
| Invalid `x-webhook-secret` | random string | 403 forbidden | 403 forbidden |
| Real DB trigger fire | -- | 500 (Resend sandbox rejection) | 500 (recorded in `net._http_response.id=1`) |

The 500 is the expected Resend sandbox behaviour: until a domain is
verified at https://resend.com/domains, the sandbox sender
`onboarding@resend.dev` can only deliver to the Resend account
holder's email (`sharath.sathish@outlook.com`).

### Resend deliverability

Direct POST to `https://api.resend.com/emails` with the production
API key:

- `from: neo-fm <onboarding@resend.dev>`
- `to: sharath.sathish@outlook.com`
- Response: HTTP 200, Resend id `9de940fc-86ea-4ac4-9861-517c0de15c99`

This confirms the API key is valid and the from-address is accepted.

## Sandbox restriction lift

To deliver to any recipient (not just the account owner):

1. Go to https://resend.com/domains.
2. Add the production domain (e.g. `neo-fm.app`).
3. Paste the four DNS records (SPF + DKIM x2 + return-path) into the
   registrar; wait ~10 minutes.
4. In Supabase Edge Function Secrets, change `RESEND_FROM` to
   `neo-fm <noreply@neo-fm.app>`.
5. Re-fire the smoke: flip a job's status to processing and back to
   completed, watch `net._http_response` show a 204.

## Evidence

- Vault entry: `select public.neo_fm_webhook_secret() is not null;`
  -> `true`
- Trigger fired log: `select * from net._http_response order by id
  desc limit 1;` -> status_code 500, body "send failed".
- Resend dashboard: https://resend.com/emails -> id
  `9de940fc-86ea-4ac4-9861-517c0de15c99` should show "delivered".
