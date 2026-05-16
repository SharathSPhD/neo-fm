/**
 * POST /api/billing/webhook
 *
 * Stripe webhook handler. Verifies the `Stripe-Signature` header against
 * `STRIPE_WEBHOOK_SECRET`, then dispatches the small subset of events we
 * care about:
 *
 *   - checkout.session.completed     -> initial upgrade
 *   - customer.subscription.created  -> idempotent reinforcement
 *   - customer.subscription.updated  -> plan change / status flip
 *   - customer.subscription.deleted  -> cancellation
 *   - customer.subscription.paused / resumed (status flip is enough)
 *
 * All of these resolve to one DB call: `apply_stripe_subscription_state()`
 * with the latest subscription state we observe. The RPC is idempotent.
 *
 * Anti-replay: Stripe sign the body with a timestamp + nonce; verifying
 * the signature already gives us replay protection within Stripe's
 * tolerance window. We don't keep our own nonce table.
 *
 * IMPORTANT: this route must NOT use the user-bound supabase client.
 * We act on behalf of the platform, not the user, so we use the
 * service-role client (the only way to call apply_stripe_subscription_state).
 *
 * Runtime: Node.js (Stripe SDK uses Node Buffer/crypto for signature
 * verification). Body must be read as raw text (req.text()).
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { getBillingConfigOrNull } from "@/lib/billing/config";
import { getStripe } from "@/lib/billing/stripe";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HANDLED_EVENTS = new Set<Stripe.Event["type"]>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export async function POST(req: Request) {
  const cfg = getBillingConfigOrNull();
  if (!cfg) {
    return NextResponse.json(
      { error: "billing_disabled" },
      { status: 503 },
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "missing_signature" },
      { status: 400 },
    );
  }

  const rawBody = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      cfg.webhookSecret,
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_signature",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    // Acknowledge so Stripe doesn't retry, but record that we ignored it.
    return NextResponse.json({ received: true, handled: false });
  }

  try {
    const apply = await applyEvent(event, cfg.prices);
    return NextResponse.json({ received: true, handled: true, ...apply });
  } catch (err) {
    // Returning 500 makes Stripe retry. That's what we want for transient
    // DB issues; we accept the cost of a (rare) duplicate retry because
    // the apply RPC is idempotent.
    return NextResponse.json(
      {
        error: "apply_failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

async function applyEvent(
  event: Stripe.Event,
  prices: { creator: string; pro: string },
): Promise<{ user_id: string; status: string } | { skipped: string }> {
  const stripe = getStripe();
  let subscriptionId: string | null = null;
  let userIdHint: string | null = null;
  let customerId: string | null = null;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== "subscription") {
      return { skipped: "non_subscription_checkout" };
    }
    subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id ?? null;
    userIdHint =
      (typeof session.client_reference_id === "string"
        ? session.client_reference_id
        : null) ??
      (session.metadata?.user_id as string | undefined) ??
      null;
    customerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id ?? null;
  } else {
    const sub = event.data.object as Stripe.Subscription;
    subscriptionId = sub.id;
    userIdHint = (sub.metadata?.user_id as string | undefined) ?? null;
    customerId =
      typeof sub.customer === "string"
        ? sub.customer
        : sub.customer?.id ?? null;
  }

  if (!subscriptionId) {
    return { skipped: "no_subscription_id" };
  }

  // Always re-fetch the subscription so we have the canonical state,
  // including the latest price, status, period_end, and cancel flag.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const priceId =
    subscription.items.data[0]?.price?.id ?? null;
  // Items have their own current_period_end on recent Stripe API
  // versions. Use the item's value as the canonical source.
  const periodEndUnix =
    subscription.items.data[0]?.current_period_end ??
    (subscription as unknown as { current_period_end?: number })
      .current_period_end ??
    null;
  const status = subscription.status;
  const cancelAtPeriodEnd = subscription.cancel_at_period_end;
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const resolvedCustomerId = stripeCustomerId ?? customerId;
  const resolvedUserId =
    userIdHint ??
    (subscription.metadata?.user_id as string | undefined) ??
    null;

  if (!resolvedUserId) {
    return { skipped: "no_user_id_metadata" };
  }
  if (!resolvedCustomerId) {
    return { skipped: "no_customer_id" };
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.rpc("apply_stripe_subscription_state", {
    p_user_id: resolvedUserId,
    p_stripe_customer_id: resolvedCustomerId,
    p_subscription_id: subscriptionId,
    p_price_id: priceId ?? "",
    p_status: status,
    p_current_period_end:
      periodEndUnix != null
        ? new Date(periodEndUnix * 1000).toISOString()
        : new Date(0).toISOString(),
    p_cancel_at_period_end: cancelAtPeriodEnd,
    p_creator_price_id: prices.creator,
    p_pro_price_id: prices.pro,
  });
  if (error) {
    throw new Error(`apply_stripe_subscription_state: ${error.message}`);
  }
  return { user_id: resolvedUserId, status };
}
