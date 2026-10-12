/**
 * POST /api/billing/checkout
 *
 * Body: `{ tier: "creator" | "pro" }`
 *
 * Returns: `{ url: string }` -- a Stripe Checkout Session URL the
 * client redirects to.
 *
 * Behaviour:
 *
 * - 401 if unauthenticated.
 * - 503 `billing_disabled` if Stripe env is not configured. The UI
 *   uses this to fall back to the waitlist CTA.
 * - 200 with a checkout URL otherwise.
 *
 * The session carries:
 *   - `client_reference_id`     = neo-fm user id (the source of truth
 *                                  the webhook keys off).
 *   - `customer_email`          = the user's auth email, so Stripe
 *                                  pre-fills it on the hosted page.
 *   - `subscription_data.metadata.user_id` = belt-and-suspenders copy
 *                                  in case Stripe drops
 *                                  client_reference_id on a future
 *                                  subscription event.
 *
 * Idempotency: we let Stripe handle dup-detection. If a user has a
 * past customer record, we reuse it via the customer-search API so we
 * don't strand orphan customers on test/staging environments.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getBillingConfigOrNull,
  getPriceIdForTier,
  getPublicAppUrl,
} from "@/lib/billing/config";
import { isLiveSubscriptionStatus, MANAGE_PLAN_URL } from "@/lib/billing/checkout-guard";
import { getStripe } from "@/lib/billing/stripe";
import { requireUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  tier: z.enum(["creator", "pro"]),
});

export async function POST(req: Request) {
  const cfg = getBillingConfigOrNull();
  if (!cfg) {
    return NextResponse.json(
      {
        error: "billing_disabled",
        details:
          "Stripe is not configured on this deployment. " +
          "See docs/RUNBOOK.md section 6 for setup.",
      },
      { status: 503 },
    );
  }

  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user, supabase } = authed;

  let parsed;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_body",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  // Look up an existing Stripe customer id if we have one, so the
  // upgrade page never strands a second customer record.
  const { data: billing } = await supabase
    .from("user_billing")
    .select("stripe_customer_id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  const stripe = getStripe();

  // A second subscription would bill the user twice for one entitlement. Plan changes and cancellation go through
  // the customer portal. past_due/unpaid still hold a live Stripe subscription that recovers when the card is fixed.
  // The mirror can lag the webhook, so when a customer is known also ask Stripe directly.
  let alreadySubscribed = isLiveSubscriptionStatus(billing?.status);
  if (!alreadySubscribed && billing?.stripe_customer_id) {
    try {
      const subs = await stripe.subscriptions.list({ customer: billing.stripe_customer_id, status: "all", limit: 10 });
      alreadySubscribed = subs.data.some((sub) => isLiveSubscriptionStatus(sub.status));
    } catch (err) {
      // Fail closed: a possible double charge is worse than asking the user to retry.
      return NextResponse.json(
        { error: "stripe_lookup_failed", details: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }
  }
  if (alreadySubscribed) {
    return NextResponse.json(
      { error: "already_subscribed", details: "Use the billing portal to change or cancel your plan.", manage_url: MANAGE_PLAN_URL },
      { status: 409 },
    );
  }

  const origin = getPublicAppUrl();

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        { price: getPriceIdForTier(parsed.tier), quantity: 1 },
      ],
      success_url: `${origin}/account?upgraded=${parsed.tier}`,
      cancel_url: `${origin}/pricing?canceled=1`,
      client_reference_id: user.id,
      ...(billing?.stripe_customer_id
        ? { customer: billing.stripe_customer_id }
        : { customer_email: user.email ?? undefined }),
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { user_id: user.id, tier: parsed.tier },
      },
      metadata: { user_id: user.id, tier: parsed.tier },
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "stripe_session_no_url" },
        { status: 502 },
      );
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json(
      {
        error: "stripe_session_failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
