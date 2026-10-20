import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("../../../lib/billing/stripe", () => ({ getStripe: () => ({ billingPortal: { sessions: { create } } }) }));
vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>("../../../lib/supabase/auth");
  return { ...mod, requireUser: vi.fn() };
});
import { requireUser } from "../../../lib/supabase/auth";

const ENV = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_x", STRIPE_PRICE_CREATOR_ID: "price_creator", STRIPE_PRICE_PRO_ID: "price_pro", NEXT_PUBLIC_APP_URL: "https://app.example" };

async function load() {
  vi.resetModules();
  Object.assign(process.env, ENV);
  return (await import("../../../app/api/billing/portal/route")).POST;
}

/** Rows per table; a table with no row answers null. */
function user(rows: Record<string, { stripe_customer_id: string | null } | null>) {
  const supabase = { from: (t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows[t] ?? null }) }) }) }) };
  vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1", email: "a@b.co" } as never, supabase: supabase as never });
}

beforeEach(() => { create.mockReset(); vi.mocked(requireUser).mockReset(); create.mockResolvedValue({ url: "https://portal.stripe.test/p1" }); });
afterEach(() => { for (const k of Object.keys(ENV)) delete process.env[k]; });

describe("POST /api/billing/portal", () => {
  it("401s when signed out", async () => {
    const POST = await load();
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await POST()).status).toBe(401);
  });
  it("uses the subscription customer when there is one", async () => {
    const POST = await load(); user({ user_billing: { stripe_customer_id: "cus_sub" }, station_passes: { stripe_customer_id: "cus_pass" } });
    expect(await (await POST()).json()).toEqual({ url: "https://portal.stripe.test/p1" });
    expect(create.mock.calls[0]![0]).toMatchObject({ customer: "cus_sub", return_url: "https://app.example/account" });
  });
  it("falls back to the Station pass customer so pass-only listeners can cancel", async () => {
    const POST = await load(); user({ station_passes: { stripe_customer_id: "cus_pass" } });
    expect((await POST()).status).toBe(200);
    expect(create.mock.calls[0]![0]).toMatchObject({ customer: "cus_pass" });
  });
  it("404s no_customer when neither row exists", async () => {
    const POST = await load(); user({});
    const res = await POST();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no_customer");
    expect(create).not.toHaveBeenCalled();
  });
});
