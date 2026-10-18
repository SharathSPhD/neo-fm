import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { scoreBoth, scoreTranscript } from "../lib/diction";

/**
 * Offline regression fixtures: real Telugu/Tamil Lyria clips from the 30 s sweep (managed-agents/QUALITY-REPORT.md),
 * with the intended sung lines and the Gemini transcript frozen. `expected` is the scorer's output when the fixture was
 * written; a change here means the scorer changed, not the audio. No network, no render spend.
 */
interface Fixture {
  id: string;
  language: string;
  lyrics: string;
  transcript: string;
  expected: { ordered: number; unordered: number; flaggedLines: number };
  storedMatchPct: number;
}
const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/diction-te-ta.json", import.meta.url), "utf8"),
) as Fixture[];

describe("Telugu/Tamil diction regression fixtures", () => {
  it("covers both languages", () => {
    expect(new Set(fixtures.map((f) => f.language))).toEqual(new Set(["Telugu", "Tamil"]));
  });

  for (const f of fixtures) {
    it(`${f.id} scores as recorded`, () => {
      const both = scoreBoth(f.lyrics, f.transcript);
      expect(both.ordered).toBe(f.expected.ordered);
      expect(both.unordered).toBe(f.expected.unordered);
      expect(scoreTranscript(f.lyrics, f.transcript).lines.filter((l) => l.flagged)).toHaveLength(f.expected.flaggedLines);
    });
  }

  it("keeps a perfectly sung Tamil clip at or above 95", () => {
    const f = fixtures.find((x) => x.id === "ta-1")!;
    expect(scoreTranscript(f.lyrics, f.transcript).matchPct).toBeGreaterThanOrEqual(95);
  });

  it("flags the Telugu clips with skipped or garbled lines", () => {
    for (const id of ["te-11", "te-14", "te-17"]) {
      const f = fixtures.find((x) => x.id === id)!;
      const s = scoreTranscript(f.lyrics, f.transcript);
      expect(s.matchPct).toBeLessThan(90);
      expect(s.lines.some((l) => l.flagged)).toBe(true);
    }
  });

  it("does not let a section header in the lyrics sink a well-sung Telugu clip (te-16 was 66 before the \\b fix)", () => {
    const f = fixtures.find((x) => x.id === "te-16")!;
    expect(f.storedMatchPct).toBe(66);
    expect(scoreTranscript(f.lyrics, f.transcript).matchPct).toBeGreaterThanOrEqual(90);
  });
});
