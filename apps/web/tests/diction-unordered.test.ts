import { describe, expect, it } from "vitest";

import { scoreBoth, scoreTranscript, scoreTranscriptUnordered } from "../lib/diction";

const A = "ಮಳೆಯ ಹನಿ ಕಿಟಕಿ ಮೇಲೆ";
const B = "ಬಸ್ಸು ಊರ ಕಡೆ ಓಡಿದೆ";
const C = "ಹಳೆಯ ದಾರಿ ಕರೆದಂತೆ";
const D = "ವೈಪರಿನ ತಾಳಕೆ ಹಾಡಿದೆ";
const lyric = [A, B, C, D].join("\n");

describe("scoreTranscriptUnordered", () => {
  it("matches the ordered scorer when the singer keeps the order", () => {
    const t = [A, B, C, D].join("\n");
    expect(scoreTranscriptUnordered(lyric, t).matchPct).toBe(100);
    expect(scoreBoth(lyric, t)).toEqual({ ordered: 100, unordered: 100 });
  });
  it("forgives sections sung in a different order", () => {
    const t = [C, D, A, B].join("\n");
    const both = scoreBoth(lyric, t);
    expect(both.unordered).toBe(100);
    expect(both.ordered).toBeLessThan(both.unordered);
  });
  it("still penalises lines that were never sung", () => {
    const t = [A, B].join("\n");
    const s = scoreTranscriptUnordered(lyric, t);
    expect(s.matchPct).toBeLessThanOrEqual(55);
    expect(s.lines.filter((l) => l.flagged)).toHaveLength(2);
  });
  it("does not let one sung hook vouch for a hook that appears twice", () => {
    const twice = [A, B, A].join("\n");
    const once = [A, B].join("\n");
    const s = scoreTranscriptUnordered(twice, once);
    expect(s.lines.filter((l) => l.flagged).length).toBe(1);
    expect(s.matchPct).toBeLessThan(80);
  });
  it("scores garbage low and empty transcript as zero", () => {
    expect(scoreTranscriptUnordered(lyric, "").matchPct).toBe(0);
    expect(scoreTranscriptUnordered(lyric, "xyz abc").matchPct).toBeLessThan(25);
  });
  it("never scores below the in-order scorer on an in-order song (sanity)", () => {
    const t = [A, B, C, D].join("\n").replace("ಹನಿ", "ಹಣಿ");
    expect(scoreTranscriptUnordered(lyric, t).matchPct).toBeGreaterThanOrEqual(scoreTranscript(lyric, t).matchPct - 2);
  });
});
