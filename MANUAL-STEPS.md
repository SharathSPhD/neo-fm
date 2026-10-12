# Manual steps to finish the neo-fm v2 launch

Only things Claude cannot do for you (they need your logins, money or DNS). Everything else, including model work (Opus, Sonnet, Haiku, Gemini), tests, PRs, deploys, migrations and production checks, is done by Claude and the project sessions without asking you.
Tell Claude "done: N" after each step. Never paste secret values in chat; paste them straight into the page named in the step.

Status as of 2026-10-12: ✅ done · ⏳ still needs you · ➖ optional.

## Summary

| # | Step | Status |
|---|------|--------|
| 1 | Production on the neo-fm-prod Supabase project | ✅ done |
| 2 | Supabase auth settings, Google sign-in | ✅ done, including the new domain (2a) |
| 3 | Stripe test webhook | ✅ done, including the new domain (3a) |
| 4 | Domain neo-fm.com | ✅ done: DNS, Vercel domains, `NEXT_PUBLIC_APP_URL` |
| 5 | Email (Resend) | ✅ done and live (songs email on completion); ⏳ only 5.5, the grievance@ mailbox forward |
| 6 | Replace CRON_SECRET | ✅ done (rotated, live after redeploy) |
| 7 | Before public launch | ⏳ |
| 8 | Rate limiting store (Upstash) | ✅ done, `/api/health` reports upstash ok |
| 9 | Re-run agent setup (removes web_fetch from the Pro agent) | ⏳ needs a secret you can paste (see 9) |
| 10 | Approve the paid test renders (about £5.50 total) | ⏳ type the approval in chat |
| 11 | Security hardening switches (ADMIN_SECRET, embedder redeploy, leaked-password protection) | ⏳ three small steps, none urgent |

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

### 2a. Add the new domain: ✅ DONE
1. Open https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/url-configuration
   - Site URL: `https://www.neo-fm.com`
   - Redirect URLs: add `https://www.neo-fm.com/**` (keep the vercel.app one too)
   - Save.
2. Open https://console.cloud.google.com/apis/credentials → your OAuth client. Only if it restricts domains: add `https://www.neo-fm.com` under Authorized JavaScript origins. The redirect URI stays `https://kgxltxvjlsnbwomklwox.supabase.co/auth/v1/callback`.
3. Tell Claude "done: 2a". Claude then runs a sign-in check on the new domain.

## 3. Stripe webhook (test mode): ✅ DONE
Endpoint created, signing secret saved in Vercel, and Claude verified a real checkout reaching the webhook and updating the plan.

### 3a. Point the webhook at the new domain: ✅ DONE
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
Free forwarding with ImprovMX, no GoDaddy mailbox needed. The only GoDaddy part is adding three DNS records (DNS is where the domain already lives).
1. Open https://improvmx.com → sign up → Add domain `neo-fm.com`.
2. Add an alias: `grievance` → `info@technektar.com`.
3. Open https://dcc.godaddy.com/control/portfolio/neo-fm.com/settings?tab=dns and add:
   - MX, Name `@`, Value `mx1.improvmx.com`, Priority 10
   - MX, Name `@`, Value `mx2.improvmx.com`, Priority 20
   - TXT, Name `@`, Value `v=spf1 include:spf.improvmx.com ~all`
   Keep every other record. The Resend records are on the `send` name, so they do not conflict.
4. Back in ImprovMX click Verify (it can take a few minutes).
5. Send a test mail to `grievance@neo-fm.com` from another address, and check it arrives at `info@technektar.com`. Then tell Claude "done: 5.5".
To reply as `grievance@neo-fm.com` later, ImprovMX has a free SMTP sender; ask Claude if you need it.

## 6. Replace CRON_SECRET with a random value: ✅ DONE
1. In a terminal run `openssl rand -hex 32` and copy the output.
2. Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables → `CRON_SECRET` → Edit → paste → Production → Save.
3. Redeploy: https://vercel.com/ss-projects-f08e52ab/neo-fm-web/deployments → latest Production row → ⋯ → Redeploy.
4. Do step 9 after this step, using the new value.

## 7. Before public launch: ⏳ (not needed yet; only when you decide to go public)
1. Stripe live mode: https://dashboard.stripe.com/products → create live prices Creator ₹299/month and Pro ₹799/month; copy the live keys from https://dashboard.stripe.com/apikeys; create the live webhook at https://dashboard.stripe.com/webhooks (URL `https://www.neo-fm.com/api/billing/webhook`); update the Stripe variables in Vercel.
2. Delete test users at https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/users: `e2e-bot@neo-fm.test`, `showcase-a`, `showcase-b`, `delivered@resend.dev`.
3. Retire the old production Supabase project once nothing uses it: https://supabase.com/dashboard/projects → old project → Settings → General → Pause or Delete.
4. Ask a native speaker for each language to review a few songs and the translated screens.
5. Have counsel review the Terms and Privacy pages (the list of questions is in `docs/LEGAL-REVIEW.md` once PR #76 is merged).

## 8. Rate limiting store (Upstash Redis, free tier): ✅ DONE
Why: without it, per-IP rate limits live in memory on each serverless instance, so abuse protection is weak. `https://www.neo-fm.com/api/health` shows `upstash: missing` until this is set.
1. Open https://console.upstash.com/redis → Create database → region `ap-south-1` (Mumbai) → Free.
2. On the database page copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables → add both for Production (Sensitive is fine for these two) → Save → redeploy as in step 6.3.
(Alternative: install the Upstash integration from https://vercel.com/marketplace/upstash, which adds both variables for you.)

## 9. Re-run agent setup: ⏳
Why: a security change removed web access (`web_fetch`) from the Pro agent. It only takes effect when the agent definitions are re-published. Vercel never shows a saved secret again, so the easy way is to set a fresh `CRON_SECRET` from your clipboard and use it straight away. Run on any terminal with internet (your Mac is fine).
1. Make a new secret and copy it, printing nothing:
   ```
   openssl rand -hex 32 | tr -d '\n' | pbcopy
   ```
2. Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables → `CRON_SECRET` → Edit → paste → Production → Save. Copy nothing else.
3. Tell Claude "secret saved". Claude redeploys so the new value is live (1 to 2 minutes).
4. Then run (still without copying anything else):
   ```
   curl -i --max-time 120 -X POST -H "Authorization: Bearer $(pbpaste)" "https://www.neo-fm.com/api/admin/ma-setup?upgrade=1"
   ```
- `200` plus JSON listing agents: worked. Tell Claude "done: 9".
- `401`: the clipboard no longer holds the secret, or the redeploy is not live yet. Repeat from 1.
- `504` or a timeout: run step 4 again; it takes up to a minute and never duplicates anything.

## 10. Approve the paid test renders: ⏳
Two small measurement runs spend real Lyria money, so Claude waits for your own words in the chat. They are: the quality re-run with full-length 60 s lyrics (about £3.75), and 3 Pro 60 s songs for the latency measurement (about £0.75). To approve, type in the chat, for example: "I approve up to £4.50 for the quality renders and £1 for the latency renders." Claude then runs them and reports the results.

## 11. Security hardening switches: ⏳ (from the security threat model, `docs/SECURITY-THREAT-MODEL.md`)
The code for all three is already merged; each needs one thing only you can do. 11b matters most (see why there); the others are not urgent. Safe in any order, except as noted in 11a.

### 11a. Give the admin routes their own secret (`ADMIN_SECRET`)
Why: today `CRON_SECRET` and `AGENT_TICK_SECRET` also open the admin routes (`ma-setup`, `stripe-setup`, `q`, funnel, health detail...). `CRON_SECRET` also travels on Vercel's cron path. With `ADMIN_SECRET` set, only that secret opens the admin routes; the two crons that still need `CRON_SECRET` (`self-improve`, `spend-monitor`) keep working with either.
1. Make a value and copy it, printing nothing: `openssl rand -hex 32 | tr -d '\n' | pbcopy`
2. Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables → Add `ADMIN_SECRET` → paste → Production → Save. Never paste it in chat.
3. Tell Claude "secret saved". Claude redeploys so it is live.
- Do step 9 (agent setup) first, or run its curl with this new secret instead of `CRON_SECRET`; after this step a `CRON_SECRET` bearer is rejected on `ma-setup` with `401`.

### 11b. Redeploy the embedder so it accepts job-bound tokens
Why: the web app now mints `v2` embed tokens that are tied to one job (a leaked token can no longer be reused for another job). The embedder code that verifies them is merged (it still accepts the old `v1` tokens and the master token), but a Cloud Run service built before that change only understands `v1`, and the app now sends `v2` for every job. So this is the one of the three to do first: until the embedder is rebuilt, the PCE poem engine's embedding calls from the agent sandbox are refused with `401`.
Run on any terminal with `gcloud` signed in (your existing `EMBED_TOKEN` is kept):
```
cd ~/neo-fm && git pull origin main && cd services/embedder
gcloud run deploy neo-fm-embedder --source . --region asia-south1 --allow-unauthenticated \
  --memory 2Gi --cpu 2 --cpu-boost --concurrency 4 --min-instances 0 --max-instances 3 --timeout 30
```
Then tell Claude "embedder redeployed"; Claude checks `/api/health` and a test embed.

### 11c. Turn on leaked-password protection in Supabase
Why: Supabase can reject passwords that appear in known breaches (HaveIBeenPwned). It is off, and the Supabase advisor flags it (T-RLS-5). It is a dashboard toggle, no code.
1. Open https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/providers → Email (or Authentication → Sign In / Providers) → **Prevent use of leaked passwords** → on → Save. (Needs the Pro plan, which the project has.)
2. Tell Claude "done: 11c".
