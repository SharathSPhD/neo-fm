/**
 * Unit tests for lib/billing/config.ts (Sprint 5a / Sprint 7.1).
 *
 * The config module reads five envs and either degrades to "billing
 * disabled" or returns a typed config. We test:
 *
 *   - happy path: all five envs set → isBillingEnabled() true
 *   - any single env missing → disabled (5 cases)
 *   - getTierForPriceId() maps creator/pro/unknown/null correctly
 *   - getBillingConfigOrThrow() error message names the missing envs
 *   - getPublicAppUrl() falls back to the canonical prod host
 *
 * Each test resets the module so the internal `cached` value doesn't
 * leak between cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_PRICE_CREATOR_ID",
  "STRIPE_PRICE_PRO_ID",
  "NEXT_PUBLIC_APP_URL",
] as const;

const FULL_ENV: Record<(typeof ENV_KEYS)[number], string> = {
  STRIPE_SECRET_KEY: "sk_test_full",
  STRIPE_WEBHOOK_SECRET: "whsec_full",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_full",
  STRIPE_PRICE_CREATOR_ID: "price_creator_123",
  STRIPE_PRICE_PRO_ID: "price_pro_456",
  NEXT_PUBLIC_APP_URL: "https://staging.neo-fm.test",
};

beforeEach(() => {
  vi.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

async function loadConfig() {
  return await import("../../lib/billing/config");
}

describe("isBillingEnabled", () => {
  it("returns true when all five env vars are set", async () => {
    Object.assign(process.env, FULL_ENV);
    const m = await loadConfig();
    expect(m.isBillingEnabled()).toBe(true);
    const cfg = m.getBillingConfigOrNull();
    expect(cfg).toEqual({
      secretKey: "sk_test_full",
      webhookSecret: "whsec_full",
      publishableKey: "pk_test_full",
      prices: { creator: "price_creator_123", pro: "price_pro_456" },
    });
  });

  for (const missing of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "STRIPE_PRICE_CREATOR_ID",
    "STRIPE_PRICE_PRO_ID",
  ] as const) {
    it(`returns false when ${missing} is missing`, async () => {
      Object.assign(process.env, FULL_ENV);
      delete process.env[missing];
      const m = await loadConfig();
      expect(m.isBillingEnabled()).toBe(false);
      expect(m.getBillingConfigOrNull()).toBeNull();
    });
  }
});

describe("getTierForPriceId", () => {
  it("maps creator and pro price ids; rejects unknown/null", async () => {
    Object.assign(process.env, FULL_ENV);
    const m = await loadConfig();
    expect(m.getTierForPriceId("price_creator_123")).toBe("creator");
    expect(m.getTierForPriceId("price_pro_456")).toBe("pro");
    expect(m.getTierForPriceId("price_unknown_999")).toBeNull();
    expect(m.getTierForPriceId(null)).toBeNull();
    expect(m.getTierForPriceId(undefined)).toBeNull();
    expect(m.getTierForPriceId("")).toBeNull();
  });

  it("returns null even for the right shape when billing is disabled", async () => {
    // We mustn't accidentally map a stale env-less request to creator.
    const m = await loadConfig();
    expect(m.getTierForPriceId("price_creator_123")).toBeNull();
  });
});

describe("getBillingConfigOrThrow", () => {
  it("throws a recognizable billing_disabled message when envs missing", async () => {
    const m = await loadConfig();
    expect(() => m.getBillingConfigOrThrow()).toThrowError(/billing_disabled/);
  });
});

describe("getPublicAppUrl", () => {
  it("uses NEXT_PUBLIC_APP_URL when set", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
    const m = await loadConfig();
    expect(m.getPublicAppUrl()).toBe("https://example.test");
  });

  it("falls back to the canonical prod host when unset/blank", async () => {
    const m = await loadConfig();
    expect(m.getPublicAppUrl()).toBe("https://neo-fm-web.vercel.app");
  });

  it("treats a whitespace-only NEXT_PUBLIC_APP_URL as unset", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "   ";
    const m = await loadConfig();
    expect(m.getPublicAppUrl()).toBe("https://neo-fm-web.vercel.app");
  });
});
