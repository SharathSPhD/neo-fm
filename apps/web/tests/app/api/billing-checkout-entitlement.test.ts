/**
 * Checkout -> webhook -> entitlement contract. The checkout route stamps the neo-fm user id on the Stripe session and
 * subscription; the webhook must resolve the same user and price from what Stripe then sends back. The tier decision
 * itself lives in SQL and is covered on real Postgres by infra/supabase/tests/billing_entitlement.sql.
 */
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionsCreate = vi.fn();
const subsList = vi.fn();
const constructEvent = vi.fn();
const retrieve = vi.fn();
const rpc = vi.fn();
const billingRow = vi.hoisted(() => ({ value: null as { stripe_customer_id: string; status: string } | null }));

vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { create: sessionsCreate } }, subscriptions: { retrieve, list: subsList }, webhooks: { constructEvent } }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc }) }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn() }));

import { requireUser } from "@/lib/supabase/auth";
import { POST as checkout } from "../../../app/api/billing/checkout/route";
import { POST as webhook } from "../../../app/api/billing/webhook/route";

const supabase = () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: billingRow.value }) }) }) }) });
const checkoutReq = (tier: string) => new Request("http://x/api/billing/checkout", { method: "POST", body: JSON.stringify({ tier }) });
const hook = () => new Request("http://x/api/billing/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" });

beforeEach(() => {
  for (const m of [sessionsCreate, constructEvent, retrieve, rpc, subsList]) m.mockReset();
  subsList.mockResolvedValue({ data: [] });
  billingRow.value = null;
  rpc.mockImplementation(async (fn: string) => (fn === "claim_stripe_event" ? { data: "claimed", error: null } : { error: null }));
  vi.mocked(requireUser).mockReset().mockResolvedValue({ user: { id: "u1", email: "a@b.c" }, supabase: supabase() } as never);
  process.env.STRIPE_SECRET_KEY = "sk_test_x"; process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_x"; process.env.STRIPE_PRICE_CREATOR_ID = "price_c"; process.env.STRIPE_PRICE_PRO_ID = "price_p";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
});

describe("POST /api/billing/checkout", () => {
  it("creates a subscription session stamped with the user id", async () => {
    sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
    const res = await checkout(checkoutReq("creator"));
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/s" });
    expect(sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: "subscription",
      client_reference_id: "u1",
      line_items: [{ price: "price_c", quantity: 1 }],
      subscription_data: { metadata: { user_id: "u1", tier: "creator" } },
    }), expect.anything());
  });
  it("passes a per-user, per-tier, per-minute idempotency key to Stripe", async () => {
    sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T20:55:10Z"));
    await checkout(checkoutReq("pro"));
    vi.setSystemTime(new Date("2026-10-12T20:55:50Z"));
    await checkout(checkoutReq("pro"));
    vi.setSystemTime(new Date("2026-10-12T20:56:05Z"));
    await checkout(checkoutReq("pro"));
    await checkout(checkoutReq("creator"));
    vi.useRealTimers();
    const keys = sessionsCreate.mock.calls.map((c) => c[1].idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[2]);
    expect(keys[0]).toContain("checkout:u1:pro:");
  });
  it("reuses the stored Stripe customer for a returning (cancelled) user", async () => {
    billingRow.value = { stripe_customer_id: "cus_9", status: "canceled" };
    sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
    await checkout(checkoutReq("pro"));
    expect(sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_9" }), expect.anything());
  });
  it.each(["active", "trialing", "past_due", "unpaid"])("refuses a second subscription while %s", async (status) => {
    billingRow.value = { stripe_customer_id: "cus_9", status };
    const res = await checkout(checkoutReq("pro"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "already_subscribed" });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
  it.each(["canceled", "incomplete_expired", "incomplete"])("lets a %s customer start a fresh checkout", async (status) => {
    billingRow.value = { stripe_customer_id: "cus_9", status };
    subsList.mockResolvedValue({ data: [{ status }] });
    sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
    expect((await checkout(checkoutReq("pro"))).status).toBe(200);
  });
  it("blocks when Stripe has a live subscription the mirror hasn't recorded yet (webhook lag)", async () => {
    billingRow.value = { stripe_customer_id: "cus_9", status: "inactive" };
    subsList.mockResolvedValue({ data: [{ status: "canceled" }, { status: "active" }] });
    const res = await checkout(checkoutReq("pro"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "already_subscribed", manage_url: "/account" });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
  it("fails closed when Stripe cannot be asked", async () => {
    billingRow.value = { stripe_customer_id: "cus_9", status: "canceled" };
    subsList.mockRejectedValue(new Error("stripe down"));
    expect((await checkout(checkoutReq("pro"))).status).toBe(502);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
  it("401 unauthenticated, 400 bad tier", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await checkout(checkoutReq("pro"))).status).toBe(401);
    expect((await checkout(checkoutReq("gold"))).status).toBe(400);
  });
});

describe("checkout -> webhook entitlement", () => {
  it("the user and price the checkout stamped are what the webhook applies", async () => {
    sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
    await checkout(checkoutReq("pro"));
    const sent = sessionsCreate.mock.calls[0]![0];

    const sub = { id: "sub_1", status: "active", cancel_at_period_end: false, customer: "cus_1", metadata: sent.subscription_data.metadata, items: { data: [{ price: { id: sent.line_items[0].price }, current_period_end: 1800000000 }] } };
    constructEvent.mockReturnValue({ id: "evt_co", type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: "sub_1", client_reference_id: sent.client_reference_id, customer: "cus_1" } } });
    retrieve.mockResolvedValue(sub);

    expect((await webhook(hook())).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("apply_stripe_subscription_state", expect.objectContaining({ p_user_id: "u1", p_price_id: "price_p", p_status: "active", p_pro_price_id: "price_p" }));
  });
  it("cancellation then payment failure both reach the RPC with the non-paying status", async () => {
    const base = { id: "sub_1", cancel_at_period_end: true, customer: "cus_1", metadata: { user_id: "u1" }, items: { data: [{ price: { id: "price_p" }, current_period_end: 1800000000 }] } };
    constructEvent.mockReturnValueOnce({ id: "e1", type: "customer.subscription.updated", data: { object: base } });
    retrieve.mockResolvedValueOnce({ ...base, status: "active" });
    await webhook(hook());
    constructEvent.mockReturnValueOnce({ id: "e2", type: "customer.subscription.updated", data: { object: base } });
    retrieve.mockResolvedValueOnce({ ...base, status: "past_due" });
    await webhook(hook());
    constructEvent.mockReturnValueOnce({ id: "e3", type: "customer.subscription.deleted", data: { object: base } });
    retrieve.mockResolvedValueOnce({ ...base, status: "canceled" });
    await webhook(hook());
    const applied = rpc.mock.calls.filter((c) => c[0] === "apply_stripe_subscription_state").map((c) => [c[1].p_status, c[1].p_cancel_at_period_end]);
    expect(applied).toEqual([["active", true], ["past_due", true], ["canceled", true]]);
  });
});
