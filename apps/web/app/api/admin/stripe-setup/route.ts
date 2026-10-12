/**
 * /api/admin/stripe-setup -- Stripe test-mode bootstrap. Auth: Bearer CRON_SECRET / AGENT_TICK_SECRET.
 *   GET   -> { mode: "test" | "live" | "missing" } (never echoes the key)
 *   POST  -> in TEST mode only: ensures Creator/Pro products + monthly INR and USD prices exist (idempotent by lookup_key)
 *            and returns the price ids (not secrets). Refuses in live mode.
 */
import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";

import { checkBearer } from "../../../../lib/agent/auth";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const mode = (k: string | undefined) => (!k ? "missing" : k.startsWith("sk_test_") || k.startsWith("rk_test_") ? "test" : "live");

// Working price points (INR is the headline currency; see managed-agents/ECONOMICS.md).
const PLANS = [
  { tier: "creator", name: "neo-fm Creator", inr: 29900, usd: 699 },
  { tier: "pro", name: "neo-fm Pro", inr: 79900, usd: 1799 },
] as const;

export async function GET(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return NextResponse.json({
    mode: mode(key),
    has_webhook_secret: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    has_publishable: Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
    has_price_ids: { creator: Boolean(process.env.STRIPE_PRICE_CREATOR_ID), pro: Boolean(process.env.STRIPE_PRICE_PRO_ID) },
  });
}

export async function POST(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (mode(key) !== "test") return NextResponse.json({ error: "refusing", message: "STRIPE_SECRET_KEY is not a test-mode key" }, { status: 409 });
  const stripe = new Stripe(key!, { apiVersion: "2025-08-27.basil" });
  const out: Record<string, { product: string; inr: string; usd: string }> = {};
  for (const p of PLANS) {
    const found = await stripe.products.search({ query: `metadata['neofm_tier']:'${p.tier}'` });
    const product = found.data[0] ?? (await stripe.products.create({ name: p.name, metadata: { neofm_tier: p.tier } }));
    const price = async (currency: "inr" | "usd", amount: number) => {
      const lookup_key = `neofm_${p.tier}_${currency}_monthly`;
      const existing = await stripe.prices.list({ lookup_keys: [lookup_key], limit: 1 });
      return (existing.data[0] ?? (await stripe.prices.create({ product: product.id, currency, unit_amount: amount, recurring: { interval: "month" }, lookup_key }))).id;
    };
    out[p.tier] = { product: product.id, inr: await price("inr", p.inr), usd: await price("usd", p.usd) };
  }
  return NextResponse.json({ mode: "test", prices: out });
}
