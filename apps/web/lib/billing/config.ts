/**
 * Billing feature flag + env wiring.
 *
 * Two things gate the entire Stripe surface:
 *
 * 1. `isBillingEnabled()` returns true iff all four required env vars
 *    are set. The UI uses it to decide between "waitlist CTA" and
 *    "real upgrade CTA"; the API uses it to fail fast with a 503 so
 *    we never hit Stripe with a `undefined` key.
 *
 * 2. `getTierForPriceId(priceId)` is the only place that maps a
 *    Stripe price id back to our `tier_enum`. Centralizing it here
 *    keeps the webhook route and the apply RPC honest.
 *
 * ADR 0023 has the full picture.
 */
import "server-only";

export type BillableTier = "creator" | "pro";

export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
  prices: Record<BillableTier, string>;
}

/**
 * Reads the four billing env vars. Throws only if explicitly called when
 * billing is meant to be enabled; the public surface uses
 * `getBillingConfigOrNull()` so we degrade gracefully in dev/preview.
 */
function readEnv(): BillingConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const creatorPrice = process.env.STRIPE_PRICE_CREATOR_ID;
  const proPrice = process.env.STRIPE_PRICE_PRO_ID;
  if (
    !secretKey ||
    !webhookSecret ||
    !publishableKey ||
    !creatorPrice ||
    !proPrice
  ) {
    return null;
  }
  return {
    secretKey,
    webhookSecret,
    publishableKey,
    prices: { creator: creatorPrice, pro: proPrice },
  };
}

let cached: BillingConfig | null | undefined;

export function getBillingConfigOrNull(): BillingConfig | null {
  if (cached === undefined) {
    cached = readEnv();
  }
  return cached;
}

export function isBillingEnabled(): boolean {
  return getBillingConfigOrNull() !== null;
}

export function getBillingConfigOrThrow(): BillingConfig {
  const cfg = getBillingConfigOrNull();
  if (!cfg) {
    throw new Error(
      "billing_disabled: set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, " +
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_PRICE_CREATOR_ID, " +
        "STRIPE_PRICE_PRO_ID in Vercel project env to enable.",
    );
  }
  return cfg;
}

export function getPriceIdForTier(tier: BillableTier): string {
  return getBillingConfigOrThrow().prices[tier];
}

export function getTierForPriceId(
  priceId: string | null | undefined,
): BillableTier | null {
  if (!priceId) return null;
  const cfg = getBillingConfigOrNull();
  if (!cfg) return null;
  if (priceId === cfg.prices.creator) return "creator";
  if (priceId === cfg.prices.pro) return "pro";
  return null;
}

/**
 * Public origin for redirect_urls. Falls back to the current request's
 * origin via NEXT_PUBLIC_APP_URL or the canonical neo-fm-web.vercel.app
 * host so we never send Stripe a localhost URL in production by accident.
 */
export function getPublicAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "https://neo-fm-web.vercel.app"
  );
}
