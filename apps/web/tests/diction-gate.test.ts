import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { scoreTranscript, scoreTranscriptUnordered } from "../lib/diction";
import { DEFAULT_THRESHOLDS, dictionVerdict, gateMode, gateTranscript, tailUnsung } from "../lib/diction/gate";

interface Case { id: string; source: string; language: string; lyrics: string; transcript: string }
const cases = JSON.parse(readFileSync(new URL("./fixtures/diction-gate-cases.json", import.meta.url), "utf8")) as Case[];
const get = (id: string) => cases.find((c) => c.id === id)!;

describe("dictionVerdict on real renders", () => {
  it("passes a well-sung Tamil song and a well-sung Telugu song (te-16 was 66 before the header fix)", () => {
    expect(gateTranscript(get("ta-1").lyrics, get("ta-1").transcript).verdict).toBe("pass");
    expect(gateTranscript(get("te-16").lyrics, get("te-16").transcript).verdict).toBe("pass");
  });
  it("passes kn-1 (88, one soft line) and keeps it out of the review queue", () => {
    expect(gateTranscript(get("kn-1").lyrics, get("kn-1").transcript).verdict).toBe("pass");
  });
  it("flags the Bengali scrambled-and-garbled render for review at least", () => {
    const g = gateTranscript(get("bn-10").lyrics, get("bn-10").transcript);
    expect(g.verdict).not.toBe("pass");
    expect(g.unorderedPct).toBeGreaterThan(g.matchPct); // the ordered score alone overstates the damage
    expect(g.reordered).toBe(true);
  });
  it("sends the Telugu and Hindi songs that lost their last lines to review or re-render", () => {
    for (const id of ["te-11", "hi-16"]) {
      const g = gateTranscript(get(id).lyrics, get(id).transcript);
      expect(g.verdict, id).not.toBe("pass");
      expect(g.tailUnsung, id).toBeGreaterThanOrEqual(2);
      expect(g.reasons.join(" "), id).toContain("last 2 lines");
    }
  });
  it("te-11 reaches re-render; te-14 (79, one line missed) is a review, not a re-render", () => {
    expect(gateTranscript(get("te-11").lyrics, get("te-11").transcript).verdict).toBe("rerender");
    expect(gateTranscript(get("te-14").lyrics, get("te-14").transcript).verdict).toBe("review");
  });
});

describe("dictionVerdict rules", () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `ಸಾಲು ${"ಅ".repeat(6 + i)} ${"ಕ".repeat(5 + i)}`).join("\n");
  it("thresholds are inclusive at the boundary (80 passes, 79 reviews)", () => {
    const base = scoreTranscript(lines(4), lines(4));
    const mk = (pct: number) => ({ ...base, matchPct: pct });
    expect(dictionVerdict(mk(80), mk(80)).verdict).toBe("pass");
    expect(dictionVerdict(mk(79), mk(79)).verdict).toBe("review");
    expect(dictionVerdict(mk(60), mk(60)).verdict).toBe("review");
    expect(dictionVerdict(mk(59), mk(59)).verdict).toBe("rerender");
  });
  it("a perfect transcript passes and counts no tail", () => {
    const g = gateTranscript(lines(5), lines(5));
    expect(g).toMatchObject({ verdict: "pass", matchPct: 100, unorderedPct: 100, reordered: false, tailUnsung: 0 });
  });
  it("a transcript missing the last two lines is at least review even if the rest is perfect", () => {
    const g = gateTranscript(lines(8), lines(8).split("\n").slice(0, 6).join("\n"));
    expect(g.tailUnsung).toBe(2);
    expect(g.verdict).not.toBe("pass");
  });
  it("sections sung out of order do not fail the gate", () => {
    const l = lines(6).split("\n");
    const swapped = [...l.slice(3), ...l.slice(0, 3)].join("\n");
    const g = gateTranscript(l.join("\n"), swapped);
    expect(g.verdict).toBe("pass");
    expect(g.reordered).toBe(true);
  });
  it("an empty transcript is a re-render, and tailUnsung never exceeds the line count", () => {
    const g = gateTranscript(lines(4), "");
    expect(g.verdict).toBe("rerender");
    expect(tailUnsung(scoreTranscriptUnordered(lines(4), ""))).toBeLessThanOrEqual(4);
  });
  it("custom thresholds are honoured", () => {
    const g = gateTranscript(get("kn-1").lyrics, get("kn-1").transcript, { ...DEFAULT_THRESHOLDS, reviewBelow: 95 });
    expect(g.verdict).toBe("review");
  });
});

describe("gateMode", () => {
  it("defaults to shadow and only turns off on DICTION_GATE=off", () => {
    expect(gateMode({} as NodeJS.ProcessEnv)).toBe("shadow");
    expect(gateMode({ DICTION_GATE: "enforce" } as unknown as NodeJS.ProcessEnv)).toBe("shadow");
    expect(gateMode({ DICTION_GATE: "off" } as unknown as NodeJS.ProcessEnv)).toBe("off");
  });
});
