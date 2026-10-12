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
  rpc.mockReset(); rpc.mockImplementation(async (fn: string) => (fn === "claim_stripe_event" ? { data: "claimed", error: null } : { error: null }));
  constructEvent.mockReset(); retrieve.mockReset();
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
    constructEvent.mockReturnValue({ id: "evt_1", type: "customer.subscription.updated", data: { object: sub } });
    retrieve.mockResolvedValue(sub);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("apply_stripe_subscription_state", expect.objectContaining({ p_user_id: "u1", p_stripe_customer_id: "cus_1", p_price_id: "price_p", p_status: "active", p_creator_price_id: "price_c", p_pro_price_id: "price_p" }));
  });
  it("returns 500 (so Stripe retries) when the database write fails", async () => {
    constructEvent.mockReturnValue({ id: "evt_2", type: "customer.subscription.deleted", data: { object: sub } });
    retrieve.mockResolvedValue({ ...sub, status: "canceled" });
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "claim_stripe_event") return { data: "claimed", error: null };
      if (fn === "apply_stripe_subscription_state") return { error: { message: "db down" } };
      return { error: null };
    });
    const res = await POST(req());
    expect(res.status).toBe(500);
    // the claim is released so Stripe's retry is not mistaken for an in-flight delivery
    expect(rpc).toHaveBeenCalledWith("release_stripe_event", { p_event_id: "evt_2" });
    expect(rpc).not.toHaveBeenCalledWith("complete_stripe_event", expect.anything());
  });
  it("skips (no write) when the subscription carries no user id", async () => {
    const orphan = { ...sub, metadata: {} };
    constructEvent.mockReturnValue({ id: "evt_3", type: "customer.subscription.created", data: { object: orphan } });
    retrieve.mockResolvedValue(orphan);
    const res = await POST(req());
    expect(await res.json()).toMatchObject({ handled: true, skipped: "no_user_id_metadata" });
    expect(rpc).not.toHaveBeenCalledWith("apply_stripe_subscription_state", expect.anything());
  });

  it("claims the event id, applies once, then marks it processed", async () => {
    constructEvent.mockReturnValue({ id: "evt_ok", type: "customer.subscription.updated", data: { object: sub } });
    retrieve.mockResolvedValue(sub);
    await POST(req());
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["claim_stripe_event", "apply_stripe_subscription_state", "complete_stripe_event"]);
    expect(rpc).toHaveBeenCalledWith("claim_stripe_event", { p_event_id: "evt_ok", p_event_type: "customer.subscription.updated" });
    expect(rpc).toHaveBeenCalledWith("complete_stripe_event", { p_event_id: "evt_ok" });
  });
  it("acknowledges a duplicate delivery without touching Stripe or the subscription state", async () => {
    constructEvent.mockReturnValue({ id: "evt_dup", type: "customer.subscription.updated", data: { object: sub } });
    rpc.mockResolvedValue({ data: "duplicate", error: null });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, duplicate: true });
    expect(retrieve).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("returns 409 while another delivery of the same event is in flight", async () => {
    constructEvent.mockReturnValue({ id: "evt_busy", type: "customer.subscription.updated", data: { object: sub } });
    rpc.mockResolvedValue({ data: "in_flight", error: null });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(retrieve).not.toHaveBeenCalled();
  });
  it("returns 500 (retry) when the claim itself fails", async () => {
    constructEvent.mockReturnValue({ id: "evt_x", type: "customer.subscription.updated", data: { object: sub } });
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(retrieve).not.toHaveBeenCalled();
  });
  it("does not claim ignored event types", async () => {
    constructEvent.mockReturnValue({ id: "evt_i", type: "invoice.paid", data: { object: {} } });
    await POST(req());
    expect(rpc).not.toHaveBeenCalled();
  });
  it("stops retries (skips) when the user was already erased", async () => {
    constructEvent.mockReturnValue({ id: "evt_gone", type: "customer.subscription.deleted", data: { object: sub } });
    retrieve.mockResolvedValue({ ...sub, status: "canceled" });
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "claim_stripe_event") return { data: "claimed", error: null };
      if (fn === "apply_stripe_subscription_state") return { error: { code: "23503", message: "fk" } };
      return { error: null };
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: "user_deleted" });
    expect(rpc).toHaveBeenCalledWith("complete_stripe_event", { p_event_id: "evt_gone" });
  });

  it("replaying the same event id twice applies entitlement exactly once", async () => {
    const seen = new Set<string>();
    rpc.mockImplementation(async (fn: string, args: { p_event_id?: string }) => {
      if (fn === "claim_stripe_event") {
        const dup = seen.has(args.p_event_id as string);
        seen.add(args.p_event_id as string);
        return { data: dup ? "duplicate" : "claimed", error: null };
      }
      return { error: null };
    });
    constructEvent.mockReturnValue({ id: "evt_replay", type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: "sub_1", client_reference_id: "u1", customer: "cus_1" } } });
    retrieve.mockResolvedValue(sub);
    const first = await POST(req());
    const second = await POST(req());
    expect(first.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(rpc.mock.calls.filter((c) => c[0] === "apply_stripe_subscription_state")).toHaveLength(1);
  });
  it.each(["past_due", "unpaid", "canceled", "incomplete_expired"])("forwards a %s subscription so the RPC can drop the tier", async (status) => {
    constructEvent.mockReturnValue({ id: `evt_${status}`, type: "customer.subscription.updated", data: { object: sub } });
    retrieve.mockResolvedValue({ ...sub, status });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("apply_stripe_subscription_state", expect.objectContaining({ p_status: status, p_price_id: "price_p" }));
  });
  it("checkout.session.completed resolves the user from client_reference_id and applies the paid tier inputs", async () => {
    constructEvent.mockReturnValue({ id: "evt_co", type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: "sub_1", client_reference_id: "u1", customer: "cus_1" } } });
    retrieve.mockResolvedValue({ ...sub, metadata: {} });
    await POST(req());
    expect(rpc).toHaveBeenCalledWith("apply_stripe_subscription_state", expect.objectContaining({ p_user_id: "u1", p_status: "active", p_price_id: "price_p", p_pro_price_id: "price_p" }));
  });
});
