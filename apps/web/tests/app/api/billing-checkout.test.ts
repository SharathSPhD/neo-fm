import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("../../../lib/billing/stripe", () => ({ getStripe: () => ({ checkout: { sessions: { create } } }) }));
vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>("../../../lib/supabase/auth");
  return { ...mod, requireUser: vi.fn() };
});
import { requireUser } from "../../../lib/supabase/auth";

const ENV = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_x", STRIPE_PRICE_CREATOR_ID: "price_creator", STRIPE_PRICE_PRO_ID: "price_pro", NEXT_PUBLIC_APP_URL: "https://app.example" };

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
});
