/**
 * /api/admin/stripe-setup -- Stripe test-mode bootstrap. Auth: Bearer CRON_SECRET / AGENT_TICK_SECRET.
 *   GET   -> { mode: "test" | "live" | "missing" } (never echoes the key)
 *   POST  -> in TEST mode only: ensures Creator/Pro products + monthly INR and USD prices exist (idempotent by lookup_key)
 *            plus the one-off lyric-grade add-ons (STRIPE_PRICE_ADDON_PREMIUM_ID / _STUDIO_ID) and the monthly INR station pass (STRIPE_PRICE_STATION_PASS_ID), yearly INR prices (10 x monthly, 2 months free) and the one-off gift-song packs, and returns the
 *            price ids (not secrets). Refuses in live mode.
 */
import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";

import { checkAdminBearer } from "../../../../lib/agent/auth";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const mode = (k: string | undefined) => (!k ? "missing" : k.startsWith("sk_test_") || k.startsWith("rk_test_") ? "test" : "live");

// Working price points (INR is the headline currency; see managed-agents/ECONOMICS.md).
const PLANS = [
  { tier: "creator", name: "neo-fm Creator", inr: 29900, usd: 699 },
  { tier: "pro", name: "neo-fm Pro", inr: 79900, usd: 1799 },
] as const;

// One-off gift-song packs (INR only, tax-inclusive working price; UPI is INR-only).
const PACKS = [
  { sku: "single", name: "neo-fm Gift Song", inr: 9900 },
  { sku: "three", name: "neo-fm Gift Song x3", inr: 24900 },
] as const;

// Lyric-grade add-ons: one extra Premium or Studio lyrics song (INR, tax-inclusive working price; strategy/premium-lyrics-tier.md 10).
const ADDONS = [
  { grade: "premium", name: "neo-fm Premium Lyrics Song", inr: 2900 },
  { grade: "studio", name: "neo-fm Studio Lyrics Song", inr: 9900 },
] as const;

// Station pass: monthly INR, test mode only (this route refuses live keys). Working price; S sets the final one.
const STATION_PASS = { name: "neo-fm Station Pass", inr: 14900 } as const;

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return NextResponse.json({
    mode: mode(key),
    has_webhook_secret: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    has_publishable: Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
    has_price_ids: { creator: Boolean(process.env.STRIPE_PRICE_CREATOR_ID), pro: Boolean(process.env.STRIPE_PRICE_PRO_ID), creator_annual: Boolean(process.env.STRIPE_PRICE_CREATOR_ANNUAL_ID), pro_annual: Boolean(process.env.STRIPE_PRICE_PRO_ANNUAL_ID), pack_single: Boolean(process.env.STRIPE_PRICE_PACK_SINGLE_ID), pack_three: Boolean(process.env.STRIPE_PRICE_PACK_THREE_ID), station_pass: Boolean(process.env.STRIPE_PRICE_STATION_PASS_ID), addon_premium: Boolean(process.env.STRIPE_PRICE_ADDON_PREMIUM_ID), addon_studio: Boolean(process.env.STRIPE_PRICE_ADDON_STUDIO_ID) },
  });
}

export async function POST(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (mode(key) !== "test") return NextResponse.json({ error: "refusing", message: "STRIPE_SECRET_KEY is not a test-mode key" }, { status: 409 });
  const stripe = new Stripe(key!, { apiVersion: "2025-08-27.basil" });
  const out: Record<string, { product: string; inr: string; usd: string; inr_annual?: string }> = {};
  const packs: Record<string, { product: string; inr: string }> = {};
  for (const p of PLANS) {
    const found = await stripe.products.search({ query: `metadata['neofm_tier']:'${p.tier}'` });
    const product = found.data[0] ?? (await stripe.products.create({ name: p.name, metadata: { neofm_tier: p.tier } }));
    const price = async (currency: "inr" | "usd", amount: number, interval: "month" | "year" = "month") => {
      const lookup_key = `neofm_${p.tier}_${currency}_${interval === "year" ? "yearly" : "monthly"}`;
      const existing = await stripe.prices.list({ lookup_keys: [lookup_key], limit: 1 });
      return (existing.data[0] ?? (await stripe.prices.create({ product: product.id, currency, unit_amount: amount, recurring: { interval }, lookup_key }))).id;
    };
    out[p.tier] = { product: product.id, inr: await price("inr", p.inr), usd: await price("usd", p.usd), inr_annual: await price("inr", p.inr * 10, "year") };
  }
  for (const k of PACKS) {
    const found = await stripe.products.search({ query: `metadata['neofm_pack']:'${k.sku}'` });
    const product = found.data[0] ?? (await stripe.products.create({ name: k.name, metadata: { neofm_pack: k.sku } }));
    const lookup_key = `neofm_pack_${k.sku}_inr`;
    const existing = await stripe.prices.list({ lookup_keys: [lookup_key], limit: 1 });
    const price = existing.data[0] ?? (await stripe.prices.create({ product: product.id, currency: "inr", unit_amount: k.inr, lookup_key }));
    packs[k.sku] = { product: product.id, inr: price.id };
  }
  const addons: Record<string, { product: string; inr: string }> = {};
  for (const k of ADDONS) {
    const found = await stripe.products.search({ query: `metadata['neofm_addon']:'${k.grade}'` });
    const product = found.data[0] ?? (await stripe.products.create({ name: k.name, metadata: { neofm_addon: k.grade } }));
    const lookup_key = `neofm_addon_${k.grade}_inr`;
    const existing = await stripe.prices.list({ lookup_keys: [lookup_key], limit: 1 });
    const price = existing.data[0] ?? (await stripe.prices.create({ product: product.id, currency: "inr", unit_amount: k.inr, lookup_key }));
    addons[k.grade] = { product: product.id, inr: price.id };
  }
  const passFound = await stripe.products.search({ query: "metadata['neofm_pass']:'station'" });
  const passProduct = passFound.data[0] ?? (await stripe.products.create({ name: STATION_PASS.name, metadata: { neofm_pass: "station" } }));
  const passKey = "neofm_station_pass_inr_monthly";
  const passExisting = await stripe.prices.list({ lookup_keys: [passKey], limit: 1 });
  const passPrice = passExisting.data[0] ?? (await stripe.prices.create({ product: passProduct.id, currency: "inr", unit_amount: STATION_PASS.inr, recurring: { interval: "month" }, lookup_key: passKey }));
  return NextResponse.json({ mode: "test", prices: out, packs, addons, station_pass: { product: passProduct.id, inr: passPrice.id } });
}
