import { describe, expect, it } from "vitest";

import { activeLineIndex, buildLyricTimeline, parseLineTimings } from "@/lib/lyrics/sync";

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

describe("heard line timings", () => {
  const timings = {
    version: 1 as const,
    lines: [
      { i: 0, text: "one", start_s: 1, end_s: 3, sung: true },
      { i: 1, text: "two two", start_s: 3, end_s: 9, sung: false },
      { i: 2, text: "last line", start_s: 17, end_s: 24, sung: true },
    ],
  };
  it("uses heard times when the line count matches", () => {
    const lines = buildLyricTimeline(sections, 30, timings);
    expect(lines.map((l) => l.start)).toEqual([1, 3, 17]);
    expect(lines.map((l) => l.sung)).toEqual([true, false, true]);
    expect(lines[2]!.sectionType).toBe("charanam");
  });
  it("keeps heard lines and interpolates a line missing from the timings", () => {
    const lines = buildLyricTimeline(sections, 30, { ...timings, lines: timings.lines.slice(0, 2) });
    expect(lines.map((l) => l.start).slice(0, 2)).toEqual([1, 3]);
    expect(lines[2]!.sung).toBe(false);
    expect(lines[2]!.start).toBeGreaterThanOrEqual(9);
  });
  it("rejects malformed payloads", () => {
    expect(parseLineTimings(null)).toBeNull();
    expect(parseLineTimings({ version: 2, lines: [] })).toBeNull();
    expect(parseLineTimings({ version: 1, lines: [{ text: "x", start_s: 5, end_s: 1, sung: true }] })).toBeNull();
    expect(parseLineTimings(timings)).not.toBeNull();
  });
});

describe("buildLyricTimeline with heard timings", () => {
  const secs = [
    { id: "a", type: "mukhda", target_seconds: 10, lyrics: "alpha one\nbeta two" },
    { id: "b", type: "antara", target_seconds: 10, lyrics: "gamma three\ndelta four" },
  ];
  const heardAll = {
    version: 1 as const,
    lines: [
      { i: 0, text: "alpha one", start_s: 1, end_s: 4, sung: true },
      { i: 1, text: "beta two", start_s: 5, end_s: 8, sung: true },
      { i: 2, text: "gamma three", start_s: 10, end_s: 13, sung: true },
      { i: 3, text: "delta four", start_s: 14, end_s: 17, sung: true },
    ],
  };

  it("uses heard times when the lines match", () => {
    const lines = buildLyricTimeline(secs, 20, heardAll);
    expect(lines.map((l) => l.start)).toEqual([1, 5, 10, 14]);
    expect(lines.every((l) => l.sung)).toBe(true);
  });

  it("still applies when the render sang an extra closing hook the page does not show", () => {
    const withHook = { ...heardAll, lines: [...heardAll.lines, { i: 4, text: "alpha one", start_s: 18, end_s: 20, sung: true }] };
    const lines = buildLyricTimeline(secs, 20, withHook);
    expect(lines).toHaveLength(4);
    expect(lines[3]!.start).toBe(14);
  });

  it("interpolates a line the singer skipped, between its heard neighbours, and marks it unsung", () => {
    const skipped = { ...heardAll, lines: heardAll.lines.filter((l) => l.text !== "gamma three") };
    const lines = buildLyricTimeline(secs, 20, skipped);
    expect(lines[2]!.sung).toBe(false);
    expect(lines[2]!.start).toBeGreaterThanOrEqual(lines[1]!.end);
    expect(lines[2]!.end).toBeLessThanOrEqual(lines[3]!.start);
    expect(lines[3]!.start).toBe(14);
  });

  it("matches lightly edited lines, ignoring punctuation and case", () => {
    const edited = { ...heardAll, lines: heardAll.lines.map((l) => ({ ...l, text: l.text.toUpperCase() + "," })) };
    expect(buildLyricTimeline(secs, 20, edited).map((l) => l.start)).toEqual([1, 5, 10, 14]);
  });

  it("falls back to even pacing when the timings describe different lyrics", () => {
    const other = { version: 1 as const, lines: [{ i: 0, text: "zzzzzz yyyyyy", start_s: 3, end_s: 6, sung: true }, { i: 1, text: "qqqqqq wwwwww", start_s: 7, end_s: 9, sung: true }] };
    const lines = buildLyricTimeline(secs, 20, other);
    expect(lines.map((l) => l.start)).toEqual(buildLyricTimeline(secs, 20).map((l) => l.start));
  });

  it("matches Indic lines and keeps repeated hooks in order", () => {
    const s2 = [{ id: "h", type: "hook", target_seconds: 20, lyrics: "ಮಳೆಯ ಹನಿ\nಬಸ್ಸು ಊರ ಕಡೆ\nಮಳೆಯ ಹನಿ" }];
    const t = {
      version: 1 as const,
      lines: [
        { i: 0, text: "ಮಳೆಯ ಹನಿ", start_s: 0, end_s: 4, sung: true },
        { i: 1, text: "ಬಸ್ಸು ಊರ ಕಡೆ", start_s: 5, end_s: 9, sung: true },
        { i: 2, text: "ಮಳೆಯ ಹನಿ", start_s: 10, end_s: 14, sung: true },
      ],
    };
    expect(buildLyricTimeline(s2, 20, t).map((l) => l.start)).toEqual([0, 5, 10]);
  });
});
