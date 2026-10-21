import { describe, expect, it, vi } from "vitest";

import { planForTier } from "../lib/agent/tiers";
import { DEFAULT_PASS_MONTHLY_TRACKS, hasStationPass, isMissingFunction, passLyriaCapGbp, passMonthlyTracks, withPassCap } from "../lib/billing/pass";

describe("pass allowance", () => {
  it("defaults to four personal tracks a month and reads an override", () => {
    expect(passMonthlyTracks({})).toBe(DEFAULT_PASS_MONTHLY_TRACKS);
    expect(DEFAULT_PASS_MONTHLY_TRACKS).toBe(2);
    expect(passMonthlyTracks({ STATION_PASS_MONTHLY_TRACKS: "6" })).toBe(6);
    expect(passMonthlyTracks({ STATION_PASS_MONTHLY_TRACKS: "0" })).toBe(0);
  });
  it("ignores unusable overrides", () => {
    for (const v of ["", "abc", "-1", "2.5", "999"]) expect(passMonthlyTracks({ STATION_PASS_MONTHLY_TRACKS: v })).toBe(2);
  });
  it("turns the allowance into a Lyria envelope at the full-render estimate", () => {
    expect(passLyriaCapGbp({})).toBe(0.5);
    expect(passLyriaCapGbp({ STATION_PASS_MONTHLY_TRACKS: "2", LYRIA_COST_GBP_FULL: "0.3" })).toBe(0.6);
  });
});

describe("withPassCap", () => {
  it("raises a free listener's envelope to two renders", () => {
    const free = planForTier("free", null, {} as NodeJS.ProcessEnv);
    expect(free.userLyriaCapGbp).toBe(0.3);
    expect(withPassCap(free, true, {}).userLyriaCapGbp).toBe(0.5);
  });
  it("changes nothing without a pass, and never lowers a bigger envelope", () => {
    const free = planForTier("free", null, {} as NodeJS.ProcessEnv);
    expect(withPassCap(free, false, {})).toBe(free);
    const pro = planForTier("pro", null, {} as NodeJS.ProcessEnv);
    expect(withPassCap(pro, true, {}).userLyriaCapGbp).toBe(2);
    expect(withPassCap(pro, true, { STATION_PASS_MONTHLY_TRACKS: "12" }).userLyriaCapGbp).toBe(3);
  });
});

describe("hasStationPass", () => {
  const db = (impl: () => unknown) => ({ rpc: vi.fn(impl) });
  it("is true only when the function says so", async () => {
    expect(await hasStationPass(db(async () => ({ data: true, error: null })), "u1")).toBe(true);
    expect(await hasStationPass(db(async () => ({ data: false, error: null })), "u1")).toBe(false);
  });
  it("is false when the function is missing, errors or throws (migration 0098 not applied)", async () => {
    expect(await hasStationPass(db(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } })), "u1")).toBe(false);
    expect(await hasStationPass(db(async () => { throw new Error("network"); }), "u1")).toBe(false);
    expect(await hasStationPass({}, "u1")).toBe(false);
  });
  it("recognises a missing function", () => {
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ message: "function public.x does not exist" })).toBe(true);
    expect(isMissingFunction({ code: "XX000", message: "db down" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});
