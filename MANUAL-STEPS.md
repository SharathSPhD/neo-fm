# Manual steps to finish the neo-fm v2 launch

Tell Claude "done: N" after each step. Never paste secret values in chat; paste them straight into the page named in the step.

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

## 8. Soft-launch operations (S only; Claude changes nothing in prod config)
Context and verification: [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md). Tell Claude "done: 8.N" after each.

1. **Delete the prod test accounts.** Open https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/users and delete `lat-bot@neo-fm.test`, `e2e-bot@neo-fm.test`, `showcase-a` and `showcase-b` (extends step 7.2).
2. **Upstash rate limiting.** Create a free Redis database at https://console.upstash.com, copy the REST URL and REST token, then at https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (Production). Redeploy as in step 3.4.
3. **ADMIN_SECRET.** Run `openssl rand -hex 32` and add it as `ADMIN_SECRET` (Production) at the same page. Do this only after Claude confirms which PR reads it.
4. **Leaked-password protection.** Open https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/providers, Email provider, enable "Prevent use of leaked passwords" (needs the Pro plan from step 2.4).
5. **Embedder.** Check the Cloud Run service in https://console.cloud.google.com/run and tell Claude whether the latest revision is healthy or needs a rebuild. The app works without it.
6. **Vercel Web Analytics.** Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/analytics and click Enable. Claude adds the component in a PR.
7. **Anthropic admin key for the spend tracker.** Create an Admin API key at https://console.anthropic.com/settings/admin-keys and add it only as the cloud environment variable `ANTHROPIC_ADMIN_KEY`. Never paste it in chat. It is used read-only for `cost_report` and `usage_report`.
8. **Migrations 0072, 0076, 0078, 0086.** Apply each only after the lead has reviewed and merged its PR, and say go.

