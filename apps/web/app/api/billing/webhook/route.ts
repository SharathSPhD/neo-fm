/**
 * POST /api/billing/webhook
 *
 * Stripe webhook handler. Verifies the `Stripe-Signature` header against
 * `STRIPE_WEBHOOK_SECRET`, then dispatches the small subset of events we
 * care about:
 *
 *   - checkout.session.completed     -> initial upgrade, or a gift-song pack (mode=payment) once paid
 *   - checkout.session.async_payment_succeeded -> a pack whose payment settled after checkout
 *   - customer.subscription.created  -> idempotent reinforcement
 *   - customer.subscription.updated  -> plan change / status flip
 *   - customer.subscription.deleted  -> cancellation
 *   - customer.subscription.paused / resumed (status flip is enough)
 *
 * All of these resolve to one DB call: `apply_stripe_subscription_state()`
 * with the latest subscription state we observe. The RPC is idempotent.
 * The Station pass price (test mode only) goes to `apply_station_pass_state()` instead and never touches the tier.
 *
 * Idempotency: Stripe delivers at-least-once, so each event id is claimed in
 * `stripe_webhook_events` (migration 0065) before it is applied. A duplicate
 * delivery is acknowledged without re-applying; a concurrent in-flight one
 * gets 409 so Stripe retries; a failed apply releases the claim so the retry
 * can run. The signature check still guards authenticity and replay window.
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

import { getBillingConfigOrNull, getPackForPriceId, getTierForPriceId, PACK_SONGS } from "@/lib/billing/config";
import { isMissingFunction } from "@/lib/billing/pass";
import { getStripe } from "@/lib/billing/stripe";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HANDLED_EVENTS = new Set<Stripe.Event["type"]>([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
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

  const admin = createServiceRoleClient();
  const claim = await admin.rpc("claim_stripe_event", {
    p_event_id: event.id,
    p_event_type: event.type,
  });
  if (claim.error) {
    return NextResponse.json(
      { error: "claim_failed", details: claim.error.message },
      { status: 500 },
    );
  }
  if (claim.data === "duplicate") {
    return NextResponse.json({ received: true, handled: true, duplicate: true });
  }
  if (claim.data === "in_flight") {
    return NextResponse.json({ error: "event_in_flight" }, { status: 409 });
  }

  try {
    const apply = await applyEvent(event, cfg.prices);
    await admin.rpc("complete_stripe_event", { p_event_id: event.id });
    return NextResponse.json({ received: true, handled: true, ...apply });
  } catch (err) {
    await admin.rpc("release_stripe_event", { p_event_id: event.id });
    // Returning 500 makes Stripe retry. That's what we want for transient
    // DB issues; we accept the cost of a (rare) duplicate retry because
    // the apply RPC is idempotent. The claim is released above so the retry isn't seen as in-flight.
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
): Promise<{ user_id: string; status: string } | { skipped: string } | { user_id: string; pack: string }> {
  const stripe = getStripe();
  let subscriptionId: string | null = null;
  let userIdHint: string | null = null;
  let customerId: string | null = null;

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode === "payment") {
      return applyPackPurchase(session);
    }
    if (session.mode !== "subscription" || event.type !== "checkout.session.completed") {
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
  // The station pass is its own entitlement. Falling through to apply_stripe_subscription_state would treat the unknown
  // price as "free" and downgrade a paying Creator/Pro user, so it is routed to apply_station_pass_state below.
  const isPass = Boolean(priceId) && priceId === getBillingConfigOrNull()?.stationPassPrice;
  const tier = getTierForPriceId(priceId);
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
  if (isPass) {
    // Not in the generated types until migration 0098 lands, hence the cast.
    const { error: passError } = await (admin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }> }).rpc("apply_station_pass_state", {
      p_user_id: resolvedUserId,
      p_stripe_customer_id: resolvedCustomerId,
      p_subscription_id: subscriptionId,
      p_price_id: priceId ?? "",
      p_status: status,
      p_current_period_end: periodEndUnix != null ? new Date(periodEndUnix * 1000).toISOString() : new Date(0).toISOString(),
      p_cancel_at_period_end: cancelAtPeriodEnd,
    });
    if (passError) {
      if ((passError as { code?: string }).code === "23503") return { skipped: "user_deleted" };
      // Migration 0098 not applied yet: acknowledge so Stripe does not retry for days. After applying it, resend the
      // customer.subscription.* events from the Stripe dashboard (test mode) to store the pass.
      if (isMissingFunction(passError)) return { skipped: "station_pass_unavailable" };
      throw new Error(`apply_station_pass_state: ${passError.message}`);
    }
    return { user_id: resolvedUserId, status };
  }
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
    // The RPC compares the price to one id per tier; annual prices map to the same tier, so hand it the id we resolved.
    p_creator_price_id: tier === "creator" ? priceId ?? prices.creator : prices.creator,
    p_pro_price_id: tier === "pro" ? priceId ?? prices.pro : prices.pro,
  });
  if (error) {
    // FK violation: the account was erased (DELETE /api/account) before this event arrived. Retrying can never succeed.
    if ((error as { code?: string }).code === "23503") {
      return { skipped: "user_deleted" };
    }
    throw new Error(`apply_stripe_subscription_state: ${error.message}`);
  }
  return { user_id: resolvedUserId, status };
}

/**
 * One-off gift-song pack. The song count comes from the price actually purchased (looked up from Stripe, mapped
 * through env), not from session metadata. grant_song_pack is idempotent on the Checkout session id.
 */
async function applyPackPurchase(session: Stripe.Checkout.Session): Promise<{ user_id: string; pack: string } | { skipped: string }> {
  if (session.payment_status !== "paid") {
    // Delayed methods: checkout.session.async_payment_succeeded delivers the paid state later.
    return { skipped: "payment_not_paid" };
  }
  const userId =
    (typeof session.client_reference_id === "string" ? session.client_reference_id : null) ??
    (session.metadata?.user_id as string | undefined) ??
    null;
  if (!userId) return { skipped: "no_user_id_metadata" };

  const items = await getStripe().checkout.sessions.listLineItems(session.id, { limit: 10 });
  const sku = items.data.map((li) => getPackForPriceId(li.price?.id)).find((v) => v !== null) ?? null;
  if (!sku) return { skipped: "not_a_pack_price" };

  const { error } = await createServiceRoleClient().rpc("grant_song_pack", {
    p_user_id: userId,
    p_session_id: session.id,
    p_sku: sku,
    p_songs: PACK_SONGS[sku],
  });
  if (error) {
    if ((error as { code?: string }).code === "23503") return { skipped: "user_deleted" };
    throw new Error(`grant_song_pack: ${error.message}`);
  }
  return { user_id: userId, pack: sku };
}
