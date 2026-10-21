import { describe, expect, it } from "vitest";

import { interleaveMix, parseMix, parsePassMoods, passMixEnabled } from "../lib/station/lang-mix";

const known = (c: string) => ["hi", "ta", "kn", "en"].includes(c);

describe("parseMix", () => {
  it("normalises weights, drops unknown, bad and duplicate entries, and keeps at most three", () => {
    expect(parseMix("ta:60,hi:30,xx:10,ta:5,kn:10,en:10", known)).toEqual([
      { lang: "ta", weight: 0.6 },
      { lang: "hi", weight: 0.3 },
      { lang: "kn", weight: 0.1 },
    ]);
  });
  it("gives bare codes equal weight and rejects non-positive weights", () => {
    expect(parseMix("ta,hi", known).map((e) => e.weight)).toEqual([0.5, 0.5]);
    expect(parseMix("ta:0,hi:-1,kn:abc", known)).toEqual([]);
    expect(parseMix(null, known)).toEqual([]);
  });
});

describe("interleaveMix", () => {
  const list = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);
  it("follows the weights in runs of at least two", () => {
    const out = interleaveMix([{ weight: 0.7, tracks: list("t", 20) }, { weight: 0.3, tracks: list("h", 20) }], 20);
    expect(out.filter((x) => x.startsWith("t")).length).toBe(14);
    let run = 1;
    for (let i = 1; i < out.length - 1; i++) {
      if (out[i]![0] === out[i - 1]![0]) run++;
      else { expect(run).toBeGreaterThanOrEqual(2); run = 1; }
    }
  });
  it("skips a language that runs out instead of stopping", () => {
    const out = interleaveMix([{ weight: 0.5, tracks: list("t", 2) }, { weight: 0.5, tracks: list("h", 10) }], 8);
    expect(out).toHaveLength(8);
    expect(out.filter((x) => x.startsWith("t"))).toHaveLength(2);
  });
});

describe("passMixEnabled", () => {
  it("is off unless STATION_PASS_MIX=1", () => {
    expect(passMixEnabled({})).toBe(false);
    expect(passMixEnabled({ STATION_PASS_MIX: "1" })).toBe(true);
  });
});

describe("parsePassMoods", () => {
  it("keeps only pool moods, de-duplicated, at most four", () => {
    expect(parsePassMoods("Calm, romantic,calm,spicy,joyful,festive,playful")).toEqual(["calm", "romantic", "joyful", "festive"]);
    expect(parsePassMoods(undefined)).toEqual([]);
  });
});
