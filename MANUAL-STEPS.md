# Manual steps to finish the neo-fm v2 launch

Only things Claude cannot do for you (they need your logins, money or DNS). Everything else, including model work (Opus, Sonnet, Haiku, Gemini), tests, PRs, deploys, migrations and production checks, is done by Claude and the project sessions without asking you.
Tell Claude "done: N" after each step. Never paste secret values in chat; paste them straight into the page named in the step.

Status as of 2026-10-12: ✅ done · ⏳ still needs you · ➖ optional.

## Summary

| # | Step | Status |
|---|------|--------|
| 1 | Production on the neo-fm-prod Supabase project | ✅ done |
| 2 | Supabase auth settings, Google sign-in | ✅ done (old URLs); ⏳ add the new domain URLs (2a below) |
| 3 | Stripe test webhook | ✅ done, verified working; ⏳ point it at the new domain (3a below) |
| 4 | Domain neo-fm.com | ✅ done: DNS, Vercel domains, `NEXT_PUBLIC_APP_URL` |
| 5 | Email (Resend) | ✅ done and live (songs email on completion); ⏳ only 5.5, the grievance@ mailbox forward |
| 6 | Replace CRON_SECRET | ⏳ |
| 7 | Before public launch | ⏳ |
| 8 | Rate limiting store (Upstash) | ⏳ health still reports `upstash: missing` |
| 9 | Re-run agent setup (removes web_fetch from the Pro agent) | ⏳ |

## Do these next, in this order
1. **2a** Supabase auth URLs for the new domain (2 minutes). Until then sign-in from the new domain may land on the vercel.app address.
2. **3a** Stripe webhook URL for the new domain.
3. **8** Upstash keys (free).
4. **9** Re-run agent setup.
5. **6** Rotate CRON_SECRET, then **7** go-live items.
6. **5** Resend: optional.

## What Resend is for
Resend would send one email: "your song is ready" when a song finishes (and later password/receipt style mail). It is optional for launch: songs work without it and the user sees completion in the app. The code does nothing if the key is absent. Do step 5 only when you want that email. `delivered@resend.dev` in the test-user list is just Resend's test inbox address, not a service we depend on.

## 1. Switch production to the neo-fm-prod Supabase project: ✅ DONE
Verified by Claude. Redeployed.

## 2. Supabase Auth settings: ✅ DONE (original URLs)
Done and checked: Site URL and redirect URL for `https://neo-fm-web.vercel.app`, Google OAuth client and provider, Pro plan.

### 2a. Add the new domain: ⏳
1. Open https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/url-configuration
   - Site URL: `https://www.neo-fm.com`
   - Redirect URLs: add `https://www.neo-fm.com/**` (keep the vercel.app one too)
   - Save.
2. Open https://console.cloud.google.com/apis/credentials → your OAuth client. Only if it restricts domains: add `https://www.neo-fm.com` under Authorized JavaScript origins. The redirect URI stays `https://kgxltxvjlsnbwomklwox.supabase.co/auth/v1/callback`.
3. Tell Claude "done: 2a". Claude then runs a sign-in check on the new domain.

## 3. Stripe webhook (test mode): ✅ DONE
Endpoint created, signing secret saved in Vercel, and Claude verified a real checkout reaching the webhook and updating the plan.

### 3a. Point the webhook at the new domain: ⏳
1. Open https://dashboard.stripe.com/test/webhooks → your endpoint → ⋯ → Update details.
2. Endpoint URL: `https://www.neo-fm.com/api/billing/webhook` → Save. The signing secret does not change.
3. Tell Claude "done: 3a". Claude runs a checkout test again.

## 4. Domain neo-fm.com: ✅ DONE
- Vercel: `neo-fm.com` and `www.neo-fm.com` are both added and verified. The canonical address is **`https://www.neo-fm.com`**; the bare `neo-fm.com` redirects to it (308).
- GoDaddy DNS: `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com`. Vercel shows a yellow "DNS Change Recommended" badge. That is only its newer IP range; the current records keep working, so ignore it.
- `NEXT_PUBLIC_APP_URL` is saved as `https://www.neo-fm.com` (Production and Preview), as a normal non-secret variable. Vercel cannot change a Sensitive variable to another type, which is why it had to be re-added. Claude redeployed.
- Never mark a `NEXT_PUBLIC_…` variable as Sensitive. It is public by design and Vercel refuses to save it.

## 5. Email: ✅ DONE except the mailbox
Resend domain, API key and Supabase secret are in place. Claude deployed the song-ready function, added the queue wrappers (migration 0087) and a 2-minute schedule, and checked that it reads the queue. Finished songs now email their owner.

### 5.5 Forward `grievance@neo-fm.com` to `info@technektar.com`: ⏳
The domain has no mailbox, so this is a forward. Pick one:
- **GoDaddy (if your plan shows it):** https://dcc.godaddy.com/control/portfolio/neo-fm.com/settings → open the **Email** or **Forwarding** tab → Add forward → `grievance` → `info@technektar.com`. If GoDaddy only offers paid Microsoft 365 mailboxes, use the free option below.
- **Free forwarding with ImprovMX:** sign up at https://improvmx.com → Add domain `neo-fm.com` → alias `grievance` → `info@technektar.com`. Then in GoDaddy DNS (https://dcc.godaddy.com/control/portfolio/neo-fm.com/settings?tab=dns) add two MX records for `@`: `mx1.improvmx.com` priority 10 and `mx2.improvmx.com` priority 20, and a TXT record for `@` with `v=spf1 include:spf.improvmx.com ~all`. Keep every other record. The Resend records live on `send`, so they do not conflict. Click Verify in ImprovMX.
After either, send a test mail to `grievance@neo-fm.com` and tell Claude "done: 5.5".

## 6. Replace CRON_SECRET with a random value: ⏳
1. In a terminal run `openssl rand -hex 32` and copy the output.
2. Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables → `CRON_SECRET` → Edit → paste → Production → Save.
3. Redeploy: https://vercel.com/ss-projects-f08e52ab/neo-fm-web/deployments → latest Production row → ⋯ → Redeploy.
4. Do step 9 after this step, using the new value.

## 7. Before public launch: ⏳
1. Stripe live mode: https://dashboard.stripe.com/products → create live prices Creator ₹299/month and Pro ₹799/month; copy the live keys from https://dashboard.stripe.com/apikeys; create the live webhook at https://dashboard.stripe.com/webhooks (URL `https://www.neo-fm.com/api/billing/webhook`); update the Stripe variables in Vercel.
2. Delete test users at https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/users: `e2e-bot@neo-fm.test`, `showcase-a`, `showcase-b`, `delivered@resend.dev`.
3. Retire the old production Supabase project once nothing uses it: https://supabase.com/dashboard/projects → old project → Settings → General → Pause or Delete.
4. Ask a native speaker for each language to review a few songs and the translated screens.
5. Have counsel review the Terms and Privacy pages (the list of questions is in `docs/LEGAL-REVIEW.md` once PR #76 is merged).

## 8. Rate limiting store (Upstash Redis, free tier): ⏳
Why: without it, per-IP rate limits live in memory on each serverless instance, so abuse protection is weak. `https://www.neo-fm.com/api/health` shows `upstash: missing` until this is set.
1. Open https://console.upstash.com/redis → Create database → region `ap-south-1` (Mumbai) → Free.
2. On the database page copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables → add both for Production (Sensitive is fine for these two) → Save → redeploy as in step 6.3.
(Alternative: install the Upstash integration from https://vercel.com/marketplace/upstash, which adds both variables for you.)

## 9. Re-run agent setup: ⏳
Why: a security change removed web access (`web_fetch`) from the Pro agent. The change only takes effect when the agent definitions are re-published. Claude cannot send the CRON_SECRET, so run this once from your own terminal (replace `YOUR_CRON_SECRET`; do not paste it in chat):
```
curl -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" "https://www.neo-fm.com/api/admin/ma-setup?upgrade=1"
```
A JSON reply listing the agents means it worked. Tell Claude "done: 9".

## Decisions Claude is waiting for in chat (not dashboard steps)
- Paid test renders: 3 Pro 60 s songs (about £0.75) for the latency measurement, and the full-length 60 s re-run (about £3.75) for the quality report. Neither has run. Approve in chat and Claude starts them.
