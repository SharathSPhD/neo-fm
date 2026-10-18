import { describe, expect, it } from "vitest";

import { resolveClock } from "../lib/station/clock";

// 2026-10-18T20:00:00Z
const NOW = Date.UTC(2026, 9, 18, 20, 0, 0);

describe("resolveClock", () => {
  it("uses the listener's timezone", () => {
    expect(resolveClock("Asia/Kolkata", null, NOW)).toEqual({ hour: 1, month: 10, day: 19 });
    expect(resolveClock("America/Los_Angeles", null, NOW)).toEqual({ hour: 13, month: 10, day: 18 });
    expect(resolveClock("Europe/London", null, NOW)).toEqual({ hour: 21, month: 10, day: 18 });
  });
  it("prefers the timezone over a conflicting hour", () => {
    expect(resolveClock("America/Los_Angeles", "3", NOW).hour).toBe(13);
  });
  it("falls back to the hour param, then India time, on a bad or missing timezone", () => {
    expect(resolveClock("Not/AZone", "7", NOW).hour).toBe(7);
    expect(resolveClock("../../etc", null, NOW).hour).toBe(1);
    expect(resolveClock(null, "25", NOW).hour).toBe(1);
    expect(resolveClock(null, "", NOW)).toEqual({ hour: 1, month: 10, day: 19 });
  });
  it("accepts UTC", () => {
    expect(resolveClock("UTC", null, NOW)).toEqual({ hour: 20, month: 10, day: 18 });
  });
});
