import { describe, expect, it } from "vitest";

import { buildFunnel, isFunnelEvent, optedOut } from "../lib/ops/funnel";

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });

describe("funnel", () => {
  it("accepts only known events", () => {
    expect(isFunnelEvent("landing_view")).toBe(true);
    expect(isFunnelEvent("drop table")).toBe(false);
    expect(isFunnelEvent(undefined)).toBe(false);
  });

  it("treats DNT and GPC as opt-out", () => {
    expect(optedOut(h({ dnt: "1" }))).toBe(true);
    expect(optedOut(h({ "sec-gpc": "1" }))).toBe(true);
    expect(optedOut(h({}))).toBe(false);
  });

  it("sums views, ignores unknown rows and computes conversion", () => {
    const f = buildFunnel(
      [
        { day: "2026-10-11", event: "landing_view", n: 60 }, { day: "2026-10-12", event: "landing_view", n: 40 },
        { day: "2026-10-12", event: "signup_view", n: 20 }, { day: "2026-10-12", event: "bogus", n: 99 },
      ],
      { signups: 10, firstSongUsers: 4, shared: 2, gifted: 1, paidUsers: 1 }, 7,
    );
    expect(f.views).toMatchObject({ landing_view: 100, signup_view: 20, share_view: 0 });
    expect(f.conversion).toEqual({ landing_to_signup_view: 0.2, signup_view_to_signup: 0.5, signup_to_first_song: 0.4, pricing_view_to_checkout: null, signup_to_paid: 0.1 });
    expect(f).toMatchObject({ songs_gifted: 1, paid_users: 1 });
    expect(f.by_day["2026-10-12"]).toEqual({ landing_view: 40, signup_view: 20 });
  });

  it("counts checkout_started and relates it to pricing views", () => {
    expect(isFunnelEvent("checkout_started")).toBe(true);
    const f = buildFunnel(
      [{ day: "2026-10-12", event: "pricing_view", n: 50 }, { day: "2026-10-12", event: "checkout_started", n: 5 }],
      { signups: 0, firstSongUsers: 0, shared: 0, gifted: 0, paidUsers: 0 }, 7,
    );
    expect(f.views.checkout_started).toBe(5);
    expect(f.conversion.pricing_view_to_checkout).toBe(0.1);
  });

  it("returns null conversion instead of dividing by zero", () => {
    const f = buildFunnel([], { signups: 0, firstSongUsers: 0, shared: 0, gifted: 0, paidUsers: 0 }, 7);
    expect(f.conversion.signup_to_first_song).toBeNull();
  });
});
