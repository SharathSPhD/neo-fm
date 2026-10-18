import { describe, expect, it } from "vitest";

import { daypartFit, daypartOf, familiarIds, occasionThemes, programQueue } from "../lib/station/program";
import type { PoolTrack } from "../lib/station/rank";

const t = (id: string, tags: string[], language = "hi"): PoolTrack => ({ id, language, tags });
const ctx = (over: Partial<Parameters<typeof programQueue>[1]> = {}) => ({
  hour: 9, month: 3, day: 1, familiar: new Set<string>(), ...over,
});

describe("daypartOf", () => {
  it("maps hours to dayparts", () => {
    expect([5, 8, 12, 16, 19, 21, 0, 4].map(daypartOf)).toEqual(["dawn", "morning", "midday", "evening", "dusk", "night", "night", "night"]);
  });
});

describe("daypartFit", () => {
  it("rewards calm devotional at dawn and penalises dance", () => {
    expect(daypartFit(t("a", ["devotional", "calm"]), "dawn")).toBeGreaterThan(0);
    expect(daypartFit(t("b", ["energetic", "fast"]), "dawn")).toBeLessThan(0);
  });
  it("scores a track with no tags as neutral", () => {
    expect(daypartFit(t("c", []), "night")).toBe(0);
  });
});

describe("programQueue", () => {
  it("opens with the track that suits the hour, not just the top-ranked one", () => {
    const ranked = [t("lull", ["calm", "slow"]), t("dance", ["energetic", "fast", "joyful"])];
    expect(programQueue(ranked, ctx({ hour: 9 }))[0]!.id).toBe("dance");
    expect(programQueue(ranked, ctx({ hour: 23 }))[0]!.id).toBe("lull");
  });
  it("keeps rank order when no track has tags", () => {
    const ranked = [t("a", []), t("b", []), t("c", [])];
    expect(programQueue(ranked, ctx()).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("does not play two slow tracks in a row at a peak hour while alternatives exist", () => {
    const ranked = [t("s1", ["slow"]), t("s2", ["slow"]), t("m1", ["medium"]), t("m2", ["medium"])];
    const q = programQueue(ranked, ctx({ hour: 13, limit: 4 }));
    for (let i = 1; i < q.length; i++) expect(q[i]!.tags.includes("slow") && q[i - 1]!.tags.includes("slow")).toBe(false);
  });
  it("plays slow back to back when nothing else is left", () => {
    expect(programQueue([t("s1", ["slow"]), t("s2", ["slow"])], ctx({ hour: 13 }))).toHaveLength(2);
  });
  it("fills familiar slots from tracks the listener knows and exploration slots from unheard ones", () => {
    const ranked = [t("new1", []), t("new2", []), t("old1", []), t("old2", []), t("new3", []), t("old3", [])];
    const q = programQueue(ranked, ctx({ familiar: new Set(["old1", "old2", "old3"]), limit: 4 }));
    // wheel: opener, familiar, familiar, exploration
    expect(q.slice(1, 3).every((x) => x.id.startsWith("old"))).toBe(true);
    expect(q[3]!.id.startsWith("new")).toBe(true);
  });
  it("leans to the festival in the occasion slot during the Diwali window", () => {
    const ranked = [t("a", []), t("b", []), t("c", []), t("d", []), t("fest", ["diwali"]), t("e", [])];
    const q = programQueue(ranked, ctx({ month: 10, day: 25, limit: 5 }));
    expect(q[4]!.id).toBe("fest");
  });
  it("never repeats a track and respects the limit", () => {
    const ranked = Array.from({ length: 12 }, (_, i) => t(`x${i}`, i % 2 ? ["calm"] : ["energetic"]));
    const q = programQueue(ranked, ctx({ limit: 8 }));
    expect(q).toHaveLength(8);
    expect(new Set(q.map((x) => x.id)).size).toBe(8);
  });
  it("returns everything when the pool is smaller than the limit", () => {
    expect(programQueue([t("only", [])], ctx({ limit: 10 }))).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("occasion themes only inside the window", () => {
    expect(occasionThemes(10, 17)).toEqual([]);
    expect(occasionThemes(11, 5)).toContain("diwali");
    expect(occasionThemes(11, 13)).toEqual([]);
  });
  it("familiar ids come from positive signals only", () => {
    const f = familiarIds([
      { trackId: "a", kind: "finish", ageMs: 1 }, { trackId: "b", kind: "skip", ageMs: 1 }, { trackId: "c", kind: "play", ageMs: 1 },
    ]);
    expect([...f]).toEqual(["a"]);
  });
});
