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
export type BillingInterval = "month" | "year";
export type PackSku = "single" | "three";

/** Songs a pack grants. Server-side truth: the webhook derives this from the purchased price id, never from metadata. */
export const PACK_SONGS: Record<PackSku, number> = { single: 1, three: 3 };

export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
  prices: Record<BillableTier, string>;
  /** Optional: unset means that plan/pack is simply not offered. */
  annualPrices: Partial<Record<BillableTier, string>>;
  packPrices: Partial<Record<PackSku, string>>;
  /**
   * Station pass price id. Test-mode only: unset, or ignored under a live key, until the pass has a stored
   * entitlement (the webhook records nothing for it yet and must never touch the user's tier).
   */
  stationPassPrice?: string;
  /** Offer UPI on one-time packs. Only set once UPI is enabled for the Stripe account (Dashboard > Payment methods). */
  packUpi: boolean;
  /** Offer UPI AutoPay (a recurring mandate) on subscription Checkout. Test-mode keys only; see readEnv. */
  subscriptionUpi: boolean;
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
    annualPrices: {
      creator: process.env.STRIPE_PRICE_CREATOR_ANNUAL_ID || undefined,
      pro: process.env.STRIPE_PRICE_PRO_ANNUAL_ID || undefined,
    },
    packPrices: {
      single: process.env.STRIPE_PRICE_PACK_SINGLE_ID || undefined,
      three: process.env.STRIPE_PRICE_PACK_THREE_ID || undefined,
    },
    stationPassPrice: secretKey.startsWith("sk_test_") ? process.env.STRIPE_PRICE_STATION_PASS_ID || undefined : undefined,
    packUpi: process.env.STRIPE_PACK_UPI === "1",
    // A live key never offers mandates until the UPI AutoPay compliance items (MANUAL-STEPS step 13) are signed off.
    subscriptionUpi: process.env.STRIPE_SUBSCRIPTION_UPI === "1" && secretKey.startsWith("sk_test_"),
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

/** Price id for a plan at the given interval; null when the annual price is not configured. */
export function getPlanPriceId(tier: BillableTier, interval: BillingInterval): string | null {
  const cfg = getBillingConfigOrThrow();
  return interval === "year" ? cfg.annualPrices[tier] ?? null : cfg.prices[tier];
}

export function getPackForPriceId(priceId: string | null | undefined): PackSku | null {
  if (!priceId) return null;
  const packs = getBillingConfigOrNull()?.packPrices ?? {};
  return (Object.keys(packs) as PackSku[]).find((sku) => packs[sku] === priceId) ?? null;
}

export function getTierForPriceId(
  priceId: string | null | undefined,
): BillableTier | null {
  if (!priceId) return null;
  const cfg = getBillingConfigOrNull();
  if (!cfg) return null;
  if (priceId === cfg.prices.creator || priceId === cfg.annualPrices.creator) return "creator";
  if (priceId === cfg.prices.pro || priceId === cfg.annualPrices.pro) return "pro";
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
