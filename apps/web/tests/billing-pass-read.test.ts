import { describe, expect, it } from "vitest";

import { readOwnStationPass } from "@/lib/billing/pass";

function db(row: unknown, fail = false) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => { if (fail) throw new Error("no table"); return { data: row }; } }),
      }),
    }),
  };
}

const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

describe("readOwnStationPass", () => {
  it("returns a paid-up pass with its renewal date", async () => {
    const r = await readOwnStationPass(db({ status: "active", current_period_end: future, cancel_at_period_end: false }), "u1");
    expect(r).toEqual({ currentPeriodEnd: future, cancelAtPeriodEnd: false });
  });
  it("counts trialing and past_due like has_station_pass", async () => {
    expect(await readOwnStationPass(db({ status: "trialing", current_period_end: future, cancel_at_period_end: true }), "u1")).not.toBeNull();
    expect(await readOwnStationPass(db({ status: "past_due", current_period_end: future, cancel_at_period_end: false }), "u1")).not.toBeNull();
  });
  it("ignores canceled, expired or absent passes and a missing table", async () => {
    expect(await readOwnStationPass(db({ status: "canceled", current_period_end: future, cancel_at_period_end: false }), "u1")).toBeNull();
    expect(await readOwnStationPass(db({ status: "active", current_period_end: past, cancel_at_period_end: false }), "u1")).toBeNull();
    expect(await readOwnStationPass(db(null), "u1")).toBeNull();
    expect(await readOwnStationPass(db(null, true), "u1")).toBeNull();
  });
});
