# Manual steps to finish the neo-fm v2 launch

Only things Claude cannot do for you (they need your logins, money or DNS). Everything else, including model work (Opus, Sonnet, Haiku, Gemini), tests, PRs, deploys, migrations and production checks, is done by Claude and the project sessions without asking you.
Tell Claude "done: N" after each step. Never paste secret values in chat; paste them straight into the page named in the step.

## What Resend is for (answering your question)
Resend would send one email: "your song is ready" when a song finishes (and later password/receipt style mail). It is optional for launch: songs work without it and the user sees completion in the app. The code is being written to do nothing if the key is absent. Do step 5 only when you want that email. Also, `delivered@resend.dev` in the test-user list is just Resend's test inbox address, not a service we depend on.

## Needs you, in priority order
1. Step 2 (Supabase auth URLs, Pro plan): confirm done.
2. Step 3 (Stripe webhook): in Stripe, send a test webhook and confirm it shows 200.
3. Step 4 (domain neo-fm.com): needed to launch publicly.
4. Step 8 (Upstash, free): real rate limiting; the code already waits for it.
5. Step 6 (rotate CRON_SECRET), step 7 (go-live).
6. Step 5 (Resend): optional.

## 1. Switch production to the neo-fm-prod Supabase project: DONE
Verified by Claude. Redeployed.

## 2. Supabase Auth settings
1. Open https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/url-configuration
   - Site URL: `https://neo-fm-web.vercel.app`
   - Redirect URLs: add `https://neo-fm-web.vercel.app/**`
   - Save.
2. Create the Google OAuth client: https://console.cloud.google.com/apis/credentials → Create credentials → OAuth client ID → Web application.
   - Authorized redirect URI: `https://kgxltxvjlsnbwomklwox.supabase.co/auth/v1/callback`
   - Copy the client ID and client secret.
3. Open https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/providers → Google → enable → paste client ID and secret → Save.
4. Upgrade to Pro: https://supabase.com/dashboard/org/_/billing (pick the organisation that owns neo-fm-prod).

## 3. Stripe webhook (test mode)
1. Open https://dashboard.stripe.com/test/webhooks → Add endpoint.
   - Endpoint URL: `https://neo-fm-web.vercel.app/api/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
2. Open the new endpoint, click "Reveal" under Signing secret, copy `whsec_…`.
3. Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables → find `STRIPE_WEBHOOK_SECRET` → Edit → paste → Production only → Save.
4. Redeploy: https://vercel.com/ss-projects-f08e52ab/neo-fm-web/deployments → latest Production row → ⋯ → Redeploy.

## 4. Domain neo-fm.com
1. Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/domains → Add `neo-fm.com`, then add `www.neo-fm.com` and set it to redirect to `neo-fm.com`.
2. Open https://dcc.godaddy.com/control/portfolio/neo-fm.com/settings?tab=dns and set:
   - Type A, Name `@`, Value `76.76.21.21`
   - Type CNAME, Name `www`, Value `cname.vercel-dns.com`
3. When Vercel shows the domain as valid, edit `NEXT_PUBLIC_APP_URL` at the environment-variables page above to `https://neo-fm.com` (Production and Preview).
4. Update the Supabase Site URL and Redirect URLs (step 2.1) and the Stripe webhook URL (step 3.1) to `https://neo-fm.com`.
5. Redeploy as in step 3.4.

## 5. Email
1. Open https://resend.com/domains → Add domain `neo-fm.com` → add the DNS records it shows at the GoDaddy DNS page from step 4.2 → Verify.
2. Open https://resend.com/api-keys → Create API key (sending access).
3. Open https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/functions/secrets → add `RESEND_API_KEY` = the key → Save.
4. Tell Claude "done: 5". Claude then deploys the song-ready function and connects the trigger.
5. Create the mailbox `grievance@neo-fm.com`: https://account.godaddy.com/products → Email & Office → Set up, or add a forwarder to your own address.

## 6. Replace CRON_SECRET with a random value
1. In a terminal run `openssl rand -hex 32` and copy the output.
2. Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables → `CRON_SECRET` → Edit → paste → Production → Save.
3. Redeploy as in step 3.4.

## 7. Before public launch
1. Stripe live mode: https://dashboard.stripe.com/products → create live prices Creator ₹299/month and Pro ₹799/month; copy the live keys from https://dashboard.stripe.com/apikeys; create the live webhook at https://dashboard.stripe.com/webhooks; update the Stripe variables in Vercel.
2. Delete test users at https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/users: `e2e-bot@neo-fm.test`, `showcase-a`, `showcase-b`, `delivered@resend.dev`.
3. Retire the old production Supabase project once nothing uses it: https://supabase.com/dashboard/projects → old project → Settings → General → Pause or Delete.
4. Ask a native speaker for each language to review a few songs.
5. Have counsel review the Terms and Privacy pages.

## 8. Rate limiting store (Upstash Redis, free tier)
Why: without it, per-IP rate limits live in memory on each serverless instance, so abuse protection is weak. Code (PR "Upstash-backed rate limiting") falls back safely until this is set.
1. Open https://console.upstash.com/redis → Create database → region `ap-south-1` (Mumbai) → Free.
2. On the database page copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables → add both for Production (Sensitive) → Save → redeploy as in step 3.4.
(If you prefer, install the Upstash integration from https://vercel.com/marketplace/upstash, which adds both variables for you.)
