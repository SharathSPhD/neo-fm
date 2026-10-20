import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const listSubs = vi.fn(async () => ({ data: [] }));
vi.mock("../../../lib/billing/stripe", () => ({ getStripe: () => ({ checkout: { sessions: { create } }, subscriptions: { list: listSubs } }) }));
vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>("../../../lib/supabase/auth");
  return { ...mod, requireUser: vi.fn() };
});
import { requireUser } from "../../../lib/supabase/auth";

const ENV = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_x", STRIPE_PRICE_CREATOR_ID: "price_creator", STRIPE_PRICE_PRO_ID: "price_pro", NEXT_PUBLIC_APP_URL: "https://app.example", STRIPE_PRICE_PRO_ANNUAL_ID: "price_pro_year", STRIPE_PRICE_PACK_SINGLE_ID: "price_pack1", STRIPE_PACK_UPI: "1", STRIPE_SUBSCRIPTION_UPI: "", STRIPE_PRICE_STATION_PASS_ID: "price_pass" };

async function load(env: Partial<typeof ENV> | null) {
  vi.resetModules();
  for (const k of Object.keys(ENV)) delete process.env[k];
  if (env) Object.assign(process.env, env);
  return (await import("../../../app/api/billing/checkout/route")).POST;
}
const body = (b: unknown) => new Request("http://x", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b) });
const user = (customer: string | null = null) => {
  const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: customer ? { stripe_customer_id: customer } : null }) }) }) }) };
  vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1", email: "a@b.co" } as never, supabase: supabase as never });
};

beforeEach(() => { create.mockReset(); vi.mocked(requireUser).mockReset(); });
afterEach(() => { for (const k of Object.keys(ENV)) delete process.env[k]; });

describe("POST /api/billing/checkout", () => {
  it("503s with billing_disabled before doing anything when Stripe is not configured", async () => {
    const POST = await load(null);
    const res = await POST(body({ tier: "pro" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("billing_disabled");
    expect(requireUser).not.toHaveBeenCalled();
  });
  it("401s when signed out", async () => {
    const POST = await load(ENV);
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await POST(body({ tier: "pro" }))).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });
  it.each([["free"], ["developer"], [undefined], ["PRO"]])("rejects tier %s (only creator and pro can be bought)", async (tier) => {
    const POST = await load(ENV); user();
    expect((await POST(body({ tier }))).status).toBe(400);
    expect((await POST(body("{not json"))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
  it("creates a subscription session keyed to the user, with the right price and return urls", async () => {
    const POST = await load(ENV); user();
    create.mockResolvedValue({ url: "https://checkout.stripe.test/s1" });
    const res = await POST(body({ tier: "creator" }));
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/s1" });
    const arg = create.mock.calls[0]![0];
    expect(arg).toMatchObject({
      mode: "subscription", client_reference_id: "u1", customer_email: "a@b.co",
      line_items: [{ price: "price_creator", quantity: 1 }],
      success_url: "https://app.example/account?upgraded=creator", cancel_url: "https://app.example/pricing?canceled=1",
      subscription_data: { metadata: { user_id: "u1", tier: "creator" } }, metadata: { user_id: "u1", tier: "creator" },
    });
    expect(arg.customer).toBeUndefined();
  });
  it("reuses an existing Stripe customer instead of creating a second one", async () => {
    const POST = await load(ENV); user("cus_123");
    create.mockResolvedValue({ url: "https://checkout.stripe.test/s2" });
    await POST(body({ tier: "pro" }));
    const arg = create.mock.calls[0]![0];
    expect(arg.customer).toBe("cus_123");
    expect(arg.customer_email).toBeUndefined();
    expect(arg.line_items[0].price).toBe("price_pro");
  });
  it("502s when Stripe errors or returns no url", async () => {
    const POST = await load(ENV); user();
    create.mockRejectedValueOnce(new Error("stripe down"));
    const a = await POST(body({ tier: "pro" }));
    expect(a.status).toBe(502);
    expect((await a.json()).error).toBe("stripe_session_failed");
    create.mockResolvedValueOnce({ url: null });
    const b = await POST(body({ tier: "pro" }));
    expect(b.status).toBe(502);
    expect((await b.json()).error).toBe("stripe_session_no_url");
  });
  it("uses the yearly price when asked, and refuses a yearly plan that is not configured", async () => {
    const POST = await load(ENV); user();
    create.mockResolvedValue({ url: "https://checkout.stripe.test/y" });
    await POST(body({ tier: "pro", interval: "year" }));
    expect(create.mock.calls[0]![0].line_items[0].price).toBe("price_pro_year");
    const missing = await POST(body({ tier: "creator", interval: "year" }));
    expect(missing.status).toBe(503);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("sells a pack as a one-off payment with UPI, even to a subscriber", async () => {
    listSubs.mockClear();
    const POST = await load(ENV); user("cus_9");
    create.mockResolvedValue({ url: "https://checkout.stripe.test/pack" });
    const res = await POST(body({ pack: "single" }));
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/pack" });
    expect(create.mock.calls[0]![0]).toMatchObject({
      mode: "payment", payment_method_types: ["card", "upi"], customer: "cus_9", client_reference_id: "u1",
      line_items: [{ price: "price_pack1", quantity: 1 }], metadata: { user_id: "u1", pack: "single" },
    });
    expect(listSubs).not.toHaveBeenCalled();
  });
  it("offers cards only for packs until UPI is switched on, and 503s an unconfigured pack", async () => {
    const POST = await load({ ...ENV, STRIPE_PACK_UPI: "" }); user();
    create.mockResolvedValue({ url: "https://checkout.stripe.test/pack" });
    await POST(body({ pack: "single" }));
    expect(create.mock.calls[0]![0].payment_method_types).toEqual(["card"]);
    expect((await POST(body({ pack: "three" }))).status).toBe(503);
  });
  it("adds UPI AutoPay to subscription checkout only behind STRIPE_SUBSCRIPTION_UPI", async () => {
    create.mockResolvedValue({ url: "https://checkout.stripe.test/sub" });
    let POST = await load(ENV); user();
    await POST(body({ tier: "creator" }));
    expect(create.mock.calls[0]![0].payment_method_types).toEqual(["card"]);
    POST = await load({ ...ENV, STRIPE_SUBSCRIPTION_UPI: "1" }); user();
    await POST(body({ tier: "creator" }));
    expect(create.mock.calls[1]![0].payment_method_types).toEqual(["card", "upi"]);
  });
  it("opens a station pass subscription session without a tier", async () => {
    const POST = await load(ENV); user();
    create.mockResolvedValue({ url: "https://checkout.stripe.test/pass" });
    const res = await POST(body({ pass: "station" }));
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/pass" });
    expect(create.mock.calls[0]![0]).toMatchObject({
      mode: "subscription", line_items: [{ price: "price_pass", quantity: 1 }],
      success_url: "https://app.example/account?pass=station", metadata: { user_id: "u1", pass: "station" },
    });
    expect(create.mock.calls[0]![0].metadata).not.toHaveProperty("tier");
  });
  it("503s the station pass when the price id is unset", async () => {
    const POST = await load({ ...ENV, STRIPE_PRICE_STATION_PASS_ID: "" }); user();
    const res = await POST(body({ pass: "station" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("pass_unavailable");
    expect(create).not.toHaveBeenCalled();
  });
  it("never sells the station pass under a live key", async () => {
    const POST = await load({ ...ENV, STRIPE_SECRET_KEY: "sk_live_x" }); user();
    expect((await POST(body({ pass: "station" }))).status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing/checkout (Station pass already held)", () => {
  const passUser = (row: { status: string; current_period_end: string; cancel_at_period_end: boolean } | null) => {
    const supabase = {
      from: (t: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: t === "station_passes" ? row : null }) }) }),
      }),
    };
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1", email: "a@b.co" } as never, supabase: supabase as never });
  };
  const future = new Date(Date.now() + 20 * 86_400_000).toISOString();

  it("refuses a second pass checkout with 409 already_subscribed and never calls Stripe", async () => {
    const POST = await load(ENV); passUser({ status: "active", current_period_end: future, cancel_at_period_end: false });
    const res = await POST(body({ pass: "station" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("already_subscribed");
    expect(json.manage_url).toBe("/account");
    expect(create).not.toHaveBeenCalled();
  });
  it("still starts a pass checkout for someone without a paid-up pass (canceled or none)", async () => {
    const POST = await load(ENV);
    create.mockResolvedValue({ url: "https://checkout.stripe.test/pass" });
    passUser({ status: "canceled", current_period_end: future, cancel_at_period_end: false });
    expect((await POST(body({ pass: "station" }))).status).toBe(200);
    passUser(null);
    expect((await POST(body({ pass: "station" }))).status).toBe(200);
  });
});
