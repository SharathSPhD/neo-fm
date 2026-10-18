import { describe, expect, it } from "vitest";

import { isEffectivelyUnlimited, nextMonthlyReset, startOfMonthIso, summarizeUsage } from "../../lib/billing/usage";

describe("billing usage helpers", () => {
  it("resets on the first of next month in UTC, including across year end", () => {
    expect(nextMonthlyReset(new Date("2026-10-12T20:00:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nextMonthlyReset(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
  it("starts the month at 00:00 UTC regardless of local zone", () => {
    expect(startOfMonthIso(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10-01T00:00:00.000Z");
    expect(startOfMonthIso(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10-01T00:00:00.000Z");
  });
  it("computes songs left and clamps overuse", () => {
    expect(summarizeUsage(15, 4)).toMatchObject({ left: 11, fraction: 4 / 15 });
    expect(summarizeUsage(3, 5)).toMatchObject({ left: 0, fraction: 1 });
    expect(summarizeUsage(0, 0)).toMatchObject({ left: 0, fraction: 1 });
  });
  it("treats the developer tier as unlimited", () => {
    expect(isEffectivelyUnlimited(999999)).toBe(true);
    expect(isEffectivelyUnlimited(40)).toBe(false);
  });
});
