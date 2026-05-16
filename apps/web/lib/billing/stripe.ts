/**
 * Lazy Stripe client.
 *
 * We import the Stripe Node SDK only when billing is enabled. Two reasons:
 *
 * 1. Bundle hygiene: `apps/web` is built once; we don't want every dev
 *    preview to drag the Stripe SDK into the function bundle if billing
 *    isn't configured.
 * 2. Fail-fast: if the env is missing we want a single recognizable
 *    error message ("billing_disabled"), not a deep Stripe-SDK
 *    constructor crash.
 *
 * Use `getStripe()` from route handlers; never instantiate Stripe in
 * page or client components.
 */
import "server-only";

import Stripe from "stripe";

import { getBillingConfigOrThrow } from "./config";

let cached: Stripe | undefined;

export function getStripe(): Stripe {
  if (!cached) {
    const { secretKey } = getBillingConfigOrThrow();
    cached = new Stripe(secretKey, {
      // Pin the API version so future Stripe-side defaults don't surprise us.
      apiVersion: "2025-08-27.basil",
      typescript: true,
      appInfo: {
        name: "neo-fm",
        version: "1.2.0",
      },
    });
  }
  return cached;
}
