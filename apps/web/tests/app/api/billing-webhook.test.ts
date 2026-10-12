import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const constructEvent = vi.fn();
const retrieve = vi.fn();

vi.mock("@/lib/billing/stripe", () => ({ getStripe: () => ({ webhooks: { constructEvent }, subscriptions: { retrieve } }) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc }) }));

import { POST } from "../../../app/api/billing/webhook/route";

const req = (headers: Record<string, string> = { "stripe-signature": "t=1,v1=x" }) =>
  new Request("http://x/api/billing/webhook", { method: "POST", headers, body: "{}" });

beforeEach(() => {
  rpc.mockReset(); constructEvent.mockReset(); retrieve.mockReset();
  vi.resetModules();
  process.env.STRIPE_SECRET_KEY = "sk_test_x"; process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_x"; process.env.STRIPE_PRICE_CREATOR_ID = "price_c"; process.env.STRIPE_PRICE_PRO_ID = "price_p";
});

const sub = { id: "sub_1", status: "active", cancel_at_period_end: false, customer: "cus_1", metadata: { user_id: "u1" }, items: { data: [{ price: { id: "price_p" }, current_period_end: 1800000000 }] } };

describe("POST /api/billing/webhook", () => {
  it("rejects a request without a signature", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "missing_signature" });
  });
  it("rejects an invalid signature", async () => {
    constructEvent.mockImplementation(() => { throw new Error("bad sig"); });
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("acknowledges but ignores unrelated events", async () => {
    constructEvent.mockReturnValue({ type: "invoice.paid", data: { object: {} } });
    const res = await POST(req());
    expect(await res.json()).toEqual({ received: true, handled: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("applies the canonical subscription state on subscription.updated", async () => {
    constructEvent.mockReturnValue({ type: "customer.subscription.updated", data: { object: sub } });
    retrieve.mockResolvedValue(sub); rpc.mockResolvedValue({ error: null });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("apply_stripe_subscription_state", expect.objectContaining({ p_user_id: "u1", p_stripe_customer_id: "cus_1", p_price_id: "price_p", p_status: "active", p_creator_price_id: "price_c", p_pro_price_id: "price_p" }));
  });
  it("returns 500 (so Stripe retries) when the database write fails", async () => {
    constructEvent.mockReturnValue({ type: "customer.subscription.deleted", data: { object: sub } });
    retrieve.mockResolvedValue({ ...sub, status: "canceled" }); rpc.mockResolvedValue({ error: { message: "db down" } });
    const res = await POST(req());
    expect(res.status).toBe(500);
  });
  it("skips (no write) when the subscription carries no user id", async () => {
    const orphan = { ...sub, metadata: {} };
    constructEvent.mockReturnValue({ type: "customer.subscription.created", data: { object: orphan } });
    retrieve.mockResolvedValue(orphan);
    const res = await POST(req());
    expect(await res.json()).toMatchObject({ handled: true, skipped: "no_user_id_metadata" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
