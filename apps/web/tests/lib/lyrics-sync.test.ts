import { describe, expect, it } from "vitest";

import { activeLineIndex, buildLyricTimeline } from "@/lib/lyrics/sync";

const sections = [
  { id: "a", type: "pallavi", target_seconds: 10, lyrics: "one\ntwo two" },
  { id: "b", type: "interlude", target_seconds: 5 },
  { id: "c", type: "charanam", target_seconds: 15, lyrics: "last line" },
];

describe("buildLyricTimeline", () => {
  it("covers each section's span and skips lyric-less sections", () => {
    const lines = buildLyricTimeline(sections);
    expect(lines.map((l) => l.text)).toEqual(["one", "two two", "last line"]);
    expect(lines[0]!.start).toBe(0);
    expect(lines[1]!.end).toBeCloseTo(10);
    expect(lines[2]!.start).toBeCloseTo(15);
    expect(lines[2]!.end).toBeCloseTo(30);
  });

  it("scales to the real audio length", () => {
    const lines = buildLyricTimeline(sections, 60);
    expect(lines[2]!.end).toBeCloseTo(60);
    expect(lines[2]!.start).toBeCloseTo(30);
  });

  it("ignores a nonsense audio length", () => {
    const lines = buildLyricTimeline(sections, Number.NaN);
    expect(lines[2]!.end).toBeCloseTo(30);
  });

  it("shares time by line length", () => {
    const [short, long] = buildLyricTimeline([
      { id: "x", type: "verse", target_seconds: 10, lyrics: "ab\nabcdefghijklmnopqrst" },
    ]);
    expect(long!.end - long!.start).toBeGreaterThan(short!.end - short!.start);
  });

  it("handles Indic grapheme clusters without throwing", () => {
    const lines = buildLyricTimeline([
      { id: "h", type: "mukhda", target_seconds: 8, lyrics: "बारिश की पहली बूँद\nमाँ की लोरी" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.end).toBeCloseTo(8);
  });
});

describe("activeLineIndex", () => {
  const lines = buildLyricTimeline(sections);
  it("is -1 before lyrics and holds the last line through instrumentals", () => {
    expect(activeLineIndex(lines, -1)).toBe(-1);
    expect(activeLineIndex(lines, 0)).toBe(0);
    expect(activeLineIndex(lines, 12)).toBe(1);
    expect(activeLineIndex(lines, 29)).toBe(2);
    expect(activeLineIndex(lines, 500)).toBe(2);
  });
  it("copes with an empty timeline", () => {
    expect(activeLineIndex([], 3)).toBe(-1);
  });
});
