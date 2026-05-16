# Sprint 5c – Stripe end-to-end smoke (production)

**Status:** ✅ Green
**Deployment:** `dpl_FbTGBhxz7TS7ATUMchK1Jk6uCDmX` (commit `5b38fce`, branch `v1.2-bugfix-pack`, aliased to `neo-fm-web.vercel.app`)
**Smoke user:** `e2e-smoke@neo-fm.test` (Supabase user id `37a08a88-65c2-4752-bac4-106acb019656`)
**Test card:** `4242 4242 4242 4242 / 12-30 / 123 / SW1A 1AA`
**Stripe environment:** Test mode

## Phase-4 gate – evidence

| Check | Pass | Evidence |
|---|---|---|
| Dummy mode shows waitlist | ✅ | Pre-deploy main commit had `STRIPE_*` envs unset; pricing rendered "Join the waitlist" only |
| Pricing page renders Upgrade CTAs when signed in | ✅ | `03-pricing.png` — "Upgrade to Creator" / "Upgrade to Pro" |
| `POST /api/billing/checkout` returns Stripe URL | ✅ | `checkout body: {"url":"https://checkout.stripe.com/c/pay/cs_test_..."}` |
| Stripe Checkout renders Creator @ ₹399/mo | ✅ | `04-stripe-checkout.png` |
| Test card → success → `/account?upgraded=creator` | ✅ | `06-after-checkout.png` (success banner: "Welcome to Creator. Stripe confirmed payment …") |
| Webhook writes `user_billing` row | ✅ | DB shows `status=active`, `current_period_end=2026-06-16` |
| Quota upgrades from 3 → 25 | ✅ | `public.user_tier_quota(user_id)` returned `25` post-checkout (was `3` pre-checkout) |
| Account page shows CREATOR badge + Manage subscription | ✅ | `07-account.png` |

## Defect found during smoke

- **`STRIPE_PRICE_CREATOR_ID` and `STRIPE_PRICE_PRO_ID` env values were polluted with the variable label and newlines** ("`\n\n\nSTRIPE_PRICE_CREATOR_ID\n\nprice_1TXhL112pXuCiZJUgys9pWQz`"). This is a Vercel dashboard copy-paste artifact: revealing a value sometimes copies the label too. Stripe rejected the lookup with `No such price`.
- **Fix:** removed and re-added the two price envs cleanly via `vercel env add`, then `vercel deploy --prod --yes` against commit `5b38fce`.

## Manual deploy note

The current production alias (`neo-fm-web.vercel.app`) was promoted from the local `v1.2-bugfix-pack` branch via `vercel deploy --prod` because the GitHub auto-deploy only follows `main`, and `main` was still on the pre-Stripe `sprint-i` commit. The next GitHub push to `main` will redeploy from `main`. The intended hand-off is the v1.2 → main merge at the end of this plan; until then, the manual production deploy stays in place and is the source of truth for the prod alias.

## Smoke run command

```bash
cd /tmp/smoke && node upgrade-smoke.mjs
```

(Script left in `/tmp/smoke/upgrade-smoke.mjs` for future re-runs; mirrored as
`infra/scripts/smoke-stripe-upgrade.mjs` if we want a checked-in copy.)

## Follow-ups

- [ ] Optional: cancel the smoke subscription via Stripe Customer Portal once Sprint 7 e2e tests own their own ephemeral user (current Sprint 6/7 plan creates fresh users per run, so leaving `e2e-smoke` on Creator is harmless and actually useful for testing Creator-tier UI paths).
- [ ] After v1.2-bugfix-pack merges to main, re-confirm the production deployment still serves Sprint 5 code at `neo-fm-web.vercel.app` and run this same smoke once more as final gate.
