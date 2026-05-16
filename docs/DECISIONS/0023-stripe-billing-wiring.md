# ADR 0023 -- Stripe billing wiring (v1.2 Sprint 5)

Status: Accepted
Date: 2026-05-16
Author: agent + user (compound)

## Context

v1.1 ships `/pricing` with three tiers but only Free is wired through
to the quota. Creator and Pro carry "Join the waitlist" CTAs (Sprint E,
migration 0019). The user asked to wire real billing in v1.2 while
keeping a safe fallback when keys aren't configured:

> "wire up the stripe (give instruction on setting it up in a question
> communication where I give the details. If I don't give, payments
> will remain dummy for this version and users cannot yet go into paid
> modes)"

This ADR documents the choices we made to land the integration without
fragility.

## Decisions

### 1. Stripe is the source of truth for "is this user paid?"

The neo-fm DB carries only the minimum state needed to render the UI
and gate generation:

- `public.user_billing` (one row per paying user): the Stripe customer
  id, subscription id, price id, status, current period end,
  cancel-at-period-end. Absence = free tier.
- `public.users.tier`: the canonical tier the rest of the app reads.

We never compute "are you paid?" anywhere except the
`apply_stripe_subscription_state()` RPC. Two places, one rule.

### 2. One RPC mutates billing state

`public.apply_stripe_subscription_state()` is the only function that
writes to `user_billing` or sets `public.users.tier`. The webhook route
is the only caller. It runs `security definer` under `service_role`,
takes price ids as parameters (so we never hard-code them in SQL), and
maps `(price_id, status) -> tier_enum` atomically.

Quota changes happen "for free" -- `user_tier_quota()` reads
`public.users.tier`, so the moment the RPC commits, the next call to
`create_song_job()` honours the new ceiling.

### 3. Public ceilings match the /pricing page

Migration 0030 also re-aligns `user_tier_quota()` to the public
commitments:

| tier | songs / month |
| --- | --- |
| free | 3 |
| creator | 25 |
| pro | 200 |

v1.1 had quietly granted 100/1000 but no one could reach those because
no upgrade path existed. With the upgrade path landing, we close that
gap so the cap is exactly what users were promised.

### 4. Three thin route handlers, all server-only

| Route | Purpose | Notes |
| --- | --- | --- |
| `POST /api/billing/checkout` | Creates a Stripe Checkout Session | Reuses an existing customer if present. `client_reference_id` and `metadata.user_id` both carry the neo-fm user id (belt-and-suspenders for the webhook). |
| `POST /api/billing/portal` | Returns a Stripe Customer Portal URL | 404 `no_customer` if the user has never checked out. |
| `POST /api/billing/webhook` | Verifies the signature, retrieves the canonical subscription, calls the apply RPC | Only handles the events we need; acknowledges-and-ignores the rest. Returns 500 on apply failures so Stripe retries. |

All three import `getBillingConfigOrNull()` first and return 503
`billing_disabled` when env is incomplete. The UI uses the same flag
to choose between "Upgrade" and "Join waitlist" CTAs, so dummy mode
matches the v1.1 surface exactly.

### 5. Env vars (never committed)

```
STRIPE_SECRET_KEY                 sk_test_...
STRIPE_WEBHOOK_SECRET             whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY pk_test_...
STRIPE_PRICE_CREATOR_ID           price_...
STRIPE_PRICE_PRO_ID               price_...
NEXT_PUBLIC_APP_URL               https://neo-fm-web.vercel.app
```

All five Stripe vars are set in Vercel Project Settings -> Environment
Variables across `production` and `preview`. None of them live in
`.env*` files in the repo.

### 6. Why not Stripe MCP for the wiring?

Stripe MCP can create test prices and run mocks. We pushed the
human-in-the-loop steps (Dashboard configuration of webhook endpoint
URL, copying the four IDs into Vercel) into a single AskQuestion
checklist (RUNBOOK §6) because:

- The webhook endpoint URL is unique to our deployment and is one
  click in the Dashboard.
- The four IDs need to land in Vercel env, which the agent doesn't
  have write access to from this environment.

This keeps the loop tight: the operator sees exactly six fields to
fill, the agent does everything else.

## Consequences

- **Reversibility**: removing all four env vars puts the product back
  in v1.1 waitlist mode without code changes. The migration tables
  stay (empty) so future re-enablement is a one-PR change.
- **Observability**: every webhook event we ignore is acknowledged
  with `{ handled: false }` so Stripe's retry log doesn't grow. Every
  webhook we apply returns `{ user_id, status }` for log searches.
- **Test data hygiene**: the migration introduces no fixtures. Test
  customers are created on the fly by Stripe Checkout in test mode.

## Rollout

- Sprint 5a (this ADR + code, migration 0030): done.
- Sprint 5b (UI: upgrade CTA + account plan badge + Manage button):
  next.
- Sprint 5c (operator handoff: AskQuestion checklist, optional smoke
  with real test card): after the operator confirms env wiring.
