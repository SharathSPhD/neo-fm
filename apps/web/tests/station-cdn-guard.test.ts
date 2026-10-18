import { beforeEach, describe, expect, it } from "vitest";

import { cdnWithinBudget, resetCdnGuardCache, signals30d } from "../lib/station/cdn-guard";
import { mirrorAdmittedTrack } from "../lib/pool/mirror";

beforeEach(() => resetCdnGuardCache());

describe("cdnWithinBudget", () => {
  it("stays on at soft-launch scale", () => {
    expect(cdnWithinBudget({ signals30d: 5_000, poolTracks: 316 })).toBe(true);
  });
  it("stays on when the signal count is unavailable", () => {
    expect(cdnWithinBudget({ signals30d: null, poolTracks: 316 })).toBe(true);
  });
  it("turns off near the free read limit", () => {
    expect(cdnWithinBudget({ signals30d: 900_000, poolTracks: 316 })).toBe(false);
  });
  it("turns off near the free storage limit", () => {
    expect(cdnWithinBudget({ signals30d: 0, poolTracks: 1_900 })).toBe(false);
  });
});

describe("signals30d", () => {
  const client = (count: number | null, error: unknown = null, calls = { n: 0 }) => ({
    from: () => ({ select: () => ({ gte: async () => (calls.n++, { count, error }) }) }),
  });
  it("returns the count and caches it", async () => {
    const calls = { n: 0 };
    expect(await signals30d(client(42, null, calls), 1_000)).toBe(42);
    expect(await signals30d(client(99, null, calls), 2_000)).toBe(42);
    expect(calls.n).toBe(1);
  });
  it("returns null on error", async () => {
    expect(await signals30d(client(null, { message: "x" }))).toBeNull();
  });
});

describe("mirrorAdmittedTrack", () => {
  it("is a no-op without R2 env", async () => {
    expect(await mirrorAdmittedTrack({} as never, "tracks/pool/a.mp3", {})).toBe("skipped");
  });
});
