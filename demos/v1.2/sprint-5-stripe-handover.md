# Sprint 5c -- Stripe handover

Captured 2026-05-16 during v1.2 Sprint 5c.

> **Status update:** Sprint 5c completed. Smoke is green on production
> (`neo-fm-web.vercel.app`, commit `5b38fce`). See
> [`sprint-5-stripe-smoke/SUMMARY.md`](./sprint-5-stripe-smoke/SUMMARY.md) for the
> recorded run; screenshots live alongside it. The playbook below stays as the
> standing operator runbook for rotating keys or onboarding a new Stripe
> account. **Gotcha learned in this sprint:** when pasting price IDs from the
> Stripe Dashboard or Vercel reveal UI, make sure the value field contains
> **only** the `price_...` token -- copying the label and newlines around it
> corrupts the env and Stripe rejects with `No such price`.

## What the agent did automatically (Stripe MCP, test mode)

Stripe account confirmed in **TEST mode** (`livemode: false`,
account `acct_1TXgYV12pXuCiZJU`, display name `neo-fm-web`).

Two products + prices were created via the Stripe MCP:

| Product | Product id | Price id | Amount |
| --- | --- | --- | --- |
| neo-fm Creator | `prod_UWkq4YTbtbcdhf` | `price_1TXhL112pXuCiZJUgys9pWQz` | ₹399.00 INR / month |
| neo-fm Pro | `prod_UWkqkg2wqHATVZ` | `price_1TXhLF12pXuCiZJUdvObXEXU` | ₹1,499.00 INR / month |

These match the public `/pricing` copy and migration 0030's tier
mapping (Creator -> `creator` tier, 25 songs/mo; Pro -> `pro` tier,
200 songs/mo).

## What still needs operator action

The three values below cannot be returned by the Stripe MCP -- they
have to be revealed once from the Dashboard.

### 1. API keys (test mode)

Open https://dashboard.stripe.com/test/apikeys (make sure the
"Viewing test data" toggle in the top-right is ON).

Copy:

- `STRIPE_SECRET_KEY` -- starts with `sk_test_...`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` -- starts with `pk_test_...`

### 2. Webhook endpoint (test mode)

Open https://dashboard.stripe.com/test/webhooks ->
"Add endpoint".

- **Endpoint URL**:
  `https://neo-fm-web.vercel.app/api/billing/webhook`
- **Events to listen to** (search and tick each one):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.paused`
  - `customer.subscription.resumed`
- Save the endpoint, then click "Reveal" next to the signing secret.

Copy:

- `STRIPE_WEBHOOK_SECRET` -- starts with `whsec_...`

### 3. Vercel env vars (production + preview)

Open https://vercel.com/<team>/<project>/settings/environment-variables
and add the six rows:

| Name | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_...` (from step 1) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (from step 2) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` (from step 1) |
| `STRIPE_PRICE_CREATOR_ID` | `price_1TXhL112pXuCiZJUgys9pWQz` |
| `STRIPE_PRICE_PRO_ID` | `price_1TXhLF12pXuCiZJUdvObXEXU` |
| `NEXT_PUBLIC_APP_URL` | `https://neo-fm-web.vercel.app` |

Trigger a new deployment (push any commit, or hit "Redeploy" in the
Vercel UI) so Next picks the new env.

### 4. Smoke (test card)

1. Visit `https://neo-fm-web.vercel.app/pricing` as a signed-in user.
2. Click "Upgrade to Creator" -> redirected to Stripe Checkout.
3. Use card `4242 4242 4242 4242`, any future expiry, any CVC, any
   ZIP.
4. On return you land at `/account?upgraded=creator` with the green
   banner.
5. Within ~10 seconds the Subscription row should read "Active" and
   the Plan badge should flip to "Creator".
6. Click "Manage subscription" -> Stripe Customer Portal opens.

## Why we paused for an operator step

The Stripe MCP can create products and prices, but it cannot read the
secret key, the publishable key, or a webhook signing secret. Those
require Dashboard access. Vercel MCP can read project metadata but
not write env vars, so the env update has to land in the Dashboard
too.

Once the operator confirms the six env values are set, the smoke test
above is the canonical verification path for the Phase-4 gate.
