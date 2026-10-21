import { describe, expect, it } from "vitest";

import { armLabel, lyricMetrics, summarizeQuality, type QualityRow } from "../lib/ops/quality-monitor";

const KN = "ಕಡಲ ತೀರದಲಿ ಮುಂಜಾವು ಬಂತು\nಬಲೆಯ ಹೊತ್ತು ಅಪ್ಪ ದೋಣಿ ತಳ್ಳಿದ\nಕಡಲ ತೀರದಲಿ ಮುಂಜಾವು ಬಂತು";

describe("lyricMetrics", () => {
  it("measures script share, repeated lines and line length", () => {
    const m = lyricMetrics(KN, "kn");
    expect(m.lines).toBe(3);
    expect(m.scriptShare).toBeGreaterThan(0.95);
    expect(m.uniqRatio).toBeCloseTo(2 / 3, 5);
    expect(m.meanAksharas).toBeGreaterThan(5);
  });
  it("gives zero script share for Latin text in a Kannada song", () => {
    expect(lyricMetrics("kadala teeradali\nmunjaavu bantu", "kn").scriptShare).toBe(0);
  });
});

describe("armLabel", () => {
  it("labels unrecorded runs unknown and appends the roman lever", () => {
    expect(armLabel(null)).toBe("unknown");
    expect(armLabel({ arm: "refs_opus", roman: "used" })).toBe("refs_opus+roman");
    expect(armLabel({ arm: "live", roman: "off" })).toBe("live");
  });
});

describe("summarizeQuality", () => {
  const row = (o: Partial<QualityRow>): QualityRow => ({ day: "2026-10-21", language: "Kannada", quality: null, lyrics: KN, matchPct: null, unorderedPct: null, verdict: null, ...o });
  it("groups by day, language, tier and arm, averages diction and counts refs", () => {
    const s = summarizeQuality([
      row({ quality: { tier: "pro", arm: "refs_opus", refs_ids: ["kn-a", "kn-b"] }, matchPct: 90, unorderedPct: 92 }),
      row({ quality: { tier: "pro", arm: "refs_opus", refs_ids: ["kn-a"] }, matchPct: 70, unorderedPct: 78 }),
      row({ matchPct: 60 }),
    ], 14, new Date("2026-10-21T12:00:00Z"));
    const g = s.groups.find((x) => x.arm === "refs_opus")!;
    expect(g.n).toBe(2);
    expect(g.avg_unordered_pct).toBe(85);
    expect(g.under80_share).toBe(0.5);
    expect(s.groups.find((x) => x.arm === "unknown")!.avg_unordered_pct).toBe(60);
    expect(s.refs_usage.Kannada).toEqual({ "kn-a": 2, "kn-b": 1 });
    expect(s.meta_coverage).toBeCloseTo(2 / 3, 3);
  });
  it("is empty-safe", () => {
    expect(summarizeQuality([], 7).groups).toEqual([]);
  });
});
