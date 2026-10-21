import { describe, expect, it } from "vitest";

import { TIER_BLEND } from "../lib/lyrics/grade";
import { listenerMix, stationGradesEnabled } from "../lib/station/grade-mix";
import { programQueue } from "../lib/station/program";
import { rowToTrack } from "../lib/station/pool";
import type { PoolTrack } from "../lib/station/rank";

type G = "standard" | "premium" | "studio";
// Distinct families keep rotation rules out of the way; same tags keep daypart/flow neutral.
const lake = (counts: Record<G, number>): PoolTrack[] =>
  (Object.entries(counts) as [G, number][]).flatMap(([grade, n]) =>
    Array.from({ length: n }, (_, i) => ({ id: `${grade}-${i}`, language: "kn", tags: [], family: `kn:${grade}-${i}`, grade } as PoolTrack)));
const ctx = (over = {}) => ({ hour: 9, month: 3, day: 1, familiar: new Set<string>(), limit: 40, ...over });
const share = (q: PoolTrack[], g: G) => q.filter((t) => (t.grade ?? "standard") === g).length / q.length;
// Mix the lake so grades are interleaved in rank order, as a real ranking would.
const shuffled = (xs: PoolTrack[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : 1));

describe("grade blend in programQueue", () => {
  const pool = shuffled(lake({ standard: 80, premium: 40, studio: 20 }));
  it("hits each tier's share within a few points", () => {
    const free = programQueue(pool, ctx({ mix: TIER_BLEND.free }));
    expect(share(free, "studio")).toBe(0);
    expect(share(free, "premium")).toBeGreaterThanOrEqual(0.1);
    expect(share(free, "premium")).toBeLessThanOrEqual(0.25);
    const pro = programQueue(pool, ctx({ mix: TIER_BLEND.pro }));
    expect(share(pro, "studio")).toBeGreaterThan(0);
    expect(share(pro, "studio")).toBeLessThanOrEqual(0.15);
    expect(share(pro, "premium")).toBeGreaterThanOrEqual(0.22);
    expect(share(pro, "premium")).toBeLessThanOrEqual(0.4);
  });
  it("changes nothing without a mix", () => {
    const a = programQueue(pool, ctx()).map((t) => t.id);
    expect(a).toEqual(programQueue(pool, ctx({ mix: undefined })).map((t) => t.id));
  });
  it("plays an all-Standard pool as before and falls back when only held-back grades remain", () => {
    const plain = shuffled(lake({ standard: 10, premium: 0, studio: 0 }));
    expect(programQueue(plain, ctx({ mix: TIER_BLEND.pro, limit: 10 })).length).toBe(10);
    const onlyStudio = lake({ standard: 0, premium: 0, studio: 4 });
    expect(programQueue(onlyStudio, ctx({ mix: TIER_BLEND.free, limit: 4 })).length).toBe(4);
  });
});

describe("pool rows and the flag", () => {
  const row = { id: "x", title: null, audio_path: "p", duration_seconds: 60, language: "kn", genre: null, raga: null, mood: null, theme: null, tempo_band: null };
  it("reads lyric_grade, defaulting to standard when the column is absent or unknown", () => {
    expect(rowToTrack({ ...row, lyric_grade: "studio" }).grade).toBe("studio");
    expect(rowToTrack({ ...row, lyric_grade: "premium" }).grade).toBe("premium");
    expect(rowToTrack(row).grade).toBe("standard");
    expect(rowToTrack({ ...row, lyric_grade: "gold" }).grade).toBe("standard");
  });
  it("is off unless STATION_GRADES=1, and resolves the mix by tier and pass", async () => {
    expect(stationGradesEnabled({})).toBe(false);
    expect(await listenerMix({}, "u", {})).toBeUndefined();
    const on = { STATION_GRADES: "1" };
    expect(await listenerMix({}, null, on)).toEqual(TIER_BLEND.free);
    const db = (tier: string, pass: boolean) => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tier } }) }) }) }),
      rpc: async () => ({ data: pass, error: null }),
    });
    expect(await listenerMix(db("pro", false), "u", on)).toEqual(TIER_BLEND.pro);
    expect(await listenerMix(db("creator", false), "u", on)).toEqual(TIER_BLEND.creator);
    expect(await listenerMix(db("free", true), "u", on)).toEqual(TIER_BLEND.creator);
    expect(await listenerMix(db("free", false), "u", on)).toEqual(TIER_BLEND.free);
    expect(await listenerMix({ from: () => { throw new Error("x"); } }, "u", on)).toEqual(TIER_BLEND.free);
  });
});
