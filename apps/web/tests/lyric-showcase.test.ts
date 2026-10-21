import { describe, expect, it } from "vitest";

import { meanDims, showcaseCases, showcaseEnabled, signP, tally } from "../lib/lab/showcase";

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
