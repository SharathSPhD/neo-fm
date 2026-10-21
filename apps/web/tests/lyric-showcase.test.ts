import { describe, expect, it } from "vitest";

import { clipUrl, mean, meanDims, showcaseAudio, showcaseCases, showcaseEnabled, signP, tally } from "../lib/lab/showcase";

describe("showcase data", () => {
  const cases = showcaseCases();
  it("holds the 23 judged Kannada and Hindi cases with both grades", () => {
    expect(cases).toHaveLength(23);
    expect(cases.filter((c) => c.lang === "kn")).toHaveLength(12);
    expect(cases.filter((c) => c.lang === "hi")).toHaveLength(11);
    for (const c of cases) {
      expect(c.standard.length).toBeGreaterThan(50);
      expect(c.premium.length).toBeGreaterThan(50);
    }
  });
  it("reproduces the lab tallies (Claude 19-2-2, Gemini 21-2-0), judges kept separate", () => {
    expect(tally(cases, "claude")).toEqual({ premium: 19, standard: 2, tie: 2 });
    expect(tally(cases, "gemini")).toEqual({ premium: 21, standard: 2, tie: 0 });
  });
  it("flags the one unparseable verdict instead of scoring it", () => {
    const bad = cases.filter((c) => c.judges.claude.unparsed);
    expect(bad.map((c) => c.id)).toEqual(["hi-f8"]);
    expect(bad[0]?.judges.claude.diff).toBeNull();
    expect(meanDims(cases, "claude").imagery).toBeGreaterThan(1);
  });
});

describe("signP", () => {
  it("matches the lab's sign tests", () => {
    expect(signP(19, 2)).toBeLessThan(0.001);
    expect(signP(10, 10)).toBe(1);
    expect(signP(0, 0)).toBe(1);
  });
});

describe("showcaseEnabled", () => {
  it("is off unless LYRIC_SHOWCASE_ENABLED=1", () => {
    expect(showcaseEnabled({})).toBe(false);
    expect(showcaseEnabled({ LYRIC_SHOWCASE_ENABLED: "true" })).toBe(false);
    expect(showcaseEnabled({ LYRIC_SHOWCASE_ENABLED: "1" })).toBe(true);
  });
});

describe("showcase songs", () => {
  const a = showcaseAudio();
  it("lists every render of both arms with their sung-word match", () => {
    expect(a.romanization.map((g) => g.brief)).toEqual(["occ-ta-1", "occ-te-1", "occ-kn-1"]);
    expect(a.romanization.map((g) => [g.stock.length, g.romanized.length])).toEqual([[2, 3], [2, 3], [2, 2]]);
    expect(mean(a.romanization[0]!.stock.map((r) => r.diction))).toBeCloseTo(69.5);
    expect(mean(a.romanization[0]!.romanized.map((r) => r.diction))).toBeCloseTo(97.3, 1);
    expect(a.cue).toHaveLength(3);
  });
  it("links clips under showcase/ on the pool CDN only when it is configured", () => {
    expect(clipUrl("e5-ta-rom-1", undefined)).toBeNull();
    expect(clipUrl("e5-ta-rom-1", "http://insecure.example")).toBeNull();
    expect(clipUrl("e5-ta-rom-1", "https://cdn.example.com/")).toBe("https://cdn.example.com/showcase/e5-ta-rom-1.mp3");
  });
});
