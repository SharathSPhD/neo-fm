/**
 * POST /api/billing/portal
 *
 * Returns: `{ url: string }` -- a Stripe-hosted Customer Portal URL
 * where the user can manage their subscription (cancel, change plan,
 * update payment method, download invoices).
 *
 * - 401 if unauthenticated.
 * - 503 `billing_disabled` if Stripe env is not configured.
 * - 404 `no_customer` if the user has never started a checkout, so
 *   the portal would have nothing to show.
 * - 200 with a portal URL otherwise.
 *
 * The customer id comes from public.user_billing (RLS-readable by
 * the owning user). A Station pass is its own entitlement with its own
 * Stripe customer in public.station_passes (owner-readable), so pass-only
 * listeners can open the portal to cancel too. If neither has one, we have
 * no portal to open.
 */
import { NextResponse } from "next/server";

import {
  getBillingConfigOrNull,
  getPublicAppUrl,
} from "@/lib/billing/config";
import { getStripe } from "@/lib/billing/stripe";
import { requireUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The Stripe customer on the listener's own Station pass row; null when there is none or the table is missing. */
async function passCustomerId(supabase: unknown, userId: string): Promise<string | null> {
  try {
    const { data } = await (
      (supabase as { from: unknown }).from as unknown as (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { stripe_customer_id: string | null } | null }> };
        };
      }
    )("station_passes")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.stripe_customer_id ?? null;
  } catch {
    return null;
  }
}

export async function POST() {
  const cfg = getBillingConfigOrNull();
  if (!cfg) {
    return NextResponse.json(
      { error: "billing_disabled" },
      { status: 503 },
    );
  }

  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user, supabase } = authed;

  const { data: billing, error: lookupErr } = await supabase
    .from("user_billing")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (lookupErr) {
    return NextResponse.json(
      { error: "user_billing_lookup_failed", details: lookupErr.message },
      { status: 500 },
    );
  }
  let customerId = billing?.stripe_customer_id ?? null;
  if (!customerId) customerId = await passCustomerId(supabase, user.id);
  if (!customerId) {
    return NextResponse.json(
      {
        error: "no_customer",
        details:
          "No Stripe customer is associated with this account yet. " +
          "Start a checkout from /pricing first.",
      },
      { status: 404 },
    );
  }

  const stripe = getStripe();
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${getPublicAppUrl()}/account`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json(
      {
        error: "stripe_portal_failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
