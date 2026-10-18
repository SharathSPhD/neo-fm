# Handoff: billing, Stripe (test mode) and DPDP

## State
- Merged (#29): idempotent webhook (`stripe_webhook_events`, migration 0065), stale-subscription guard (0066), hardened `DELETE /api/account` and `GET /api/account/export` (v3). Both migrations are applied to prod by the lead.
- In #45 (this PR): checkout blocks active/trialing/past_due/unpaid (409 `already_subscribed`, also checks Stripe directly, fails closed with 502), per-minute Stripe idempotency key, account "Plan usage" meter, GST-consistent Terms line (counsel review pending), no-op `sendEmail` (`lib/email/send.ts`), `docs/DPDP-VERIFICATION.md`.
- Verified on prod by the lead (Stripe test mode, 4242 card): checkout, webhook events processed, tier flipped to creator. The DPDP throwaway-account run is the lead's, using `docs/DPDP-VERIFICATION.md`.
- Stripe stays in test mode. Nothing here touches live mode.

## Run and verify locally
- `pnpm install --frozen-lockfile && pnpm -r --filter "./packages/*" build`
- `cd apps/web && pnpm exec vitest run && pnpm typecheck && pnpm lint` (368 tests at last run)
- SQL tests need a throwaway Postgres 16: `createdb t && psql -v ON_ERROR_STOP=1 -d t -f infra/supabase/tests/billing_entitlement.sql` (and `stripe_webhook_events.sql`); success prints `ok ...` notices, failure raises `FAIL`.

## Open risks
- `past_due` drops to free immediately (decided for launch; a 3-day grace needs an SQL change and a migration number from the lead).
- Terms GST wording needs counsel review. `pricing_waitlist` rows keyed by email are not erased on account deletion.
- Export selects were wrong once (`user_billing.tier`, fixed in the lead's #59); only `agent_runs` has a column allow-list test, other tables do not.
- No dunning email: `sendEmail` is a no-op without `RESEND_API_KEY`, and nothing calls it from the webhook yet. Domain and Resend are not set up.
- No repo CI workflow ran on these PRs; test evidence is local runs.
- Stripe live mode and CRON_SECRET rotation remain launch tasks for the lead.

## Next 3 steps
1. Merge #45 (re-review done by the lead), then run the DPDP checklist on a throwaway user and record evidence.
2. Wire dunning: on `customer.subscription.updated` to `past_due`, call `sendEmail` (after Resend and the sending domain exist), with a test.
3. Add column allow-list tests for every table the export reads, and decide the past_due grace period.
