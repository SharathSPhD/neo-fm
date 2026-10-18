import { describe, expect, it } from "vitest";

import { alignLines, parseTime, toPayload } from "../lib/diction/timestamps";

const lines: string[] = ["ಮಳೆಯ ಹನಿ ಕಿಟಕಿ ಮೇಲೆ", "ಬಸ್ಸು ಊರ ಕಡೆ ಓಡಿದೆ", "ಹಳೆಯ ದಾರಿ ಕರೆದಂತೆ", "ವೈಪರಿನ ತಾಳಕೆ ಹಾಡಿದೆ"];
const L = (i: number): string => lines[i] ?? "";

describe("alignLines", () => {
  it("places lines when segments match 1:1", () => {
    const segs = lines.map((text, i) => ({ startS: i * 5, text }));
    const out = alignLines(lines, segs, 20);
    expect(out.map((l) => l.startS)).toEqual([0, 5, 10, 15]);
    expect(out.every((l) => l.sung)).toBe(true);
  });
  it("copes with segments split finer than the lines", () => {
    const segs = [
      { startS: 0, text: "ಮಳೆಯ ಹನಿ" }, { startS: 2, text: "ಕಿಟಕಿ ಮೇಲೆ" }, { startS: 5, text: "ಬಸ್ಸು ಊರ" }, { startS: 7, text: "ಕಡೆ ಓಡಿದೆ" },
      { startS: 10, text: L(2) }, { startS: 15, text: L(3) },
    ];
    const out = alignLines(lines, segs, 20);
    expect(out[1]?.startS).toBeCloseTo(5, 0);
    expect(out[2]?.startS).toBeCloseTo(10, 0);
    expect(out.every((l) => l.sung)).toBe(true);
  });
  it("interpolates a line that was never sung and stays monotonic", () => {
    const segs = [{ startS: 0, text: L(0) }, { startS: 10, text: L(2) }, { startS: 15, text: L(3) }];
    const out = alignLines(lines, segs, 20);
    expect(out[1]?.sung).toBe(false);
    for (let i = 1; i < out.length; i++) expect(out[i]?.startS ?? 0).toBeGreaterThanOrEqual(out[i - 1]?.startS ?? 0);
  });
  it("returns an all-unsung timeline for an empty transcript", () => {
    expect(alignLines(lines, [], 20).every((l) => !l.sung)).toBe(true);
  });
});

describe("parseTime / toPayload", () => {
  it("parses numbers and m:ss strings", () => {
    expect(parseTime(2.5)).toBe(2.5);
    expect(parseTime("1:05.5")).toBe(65.5);
    expect(parseTime("x")).toBeNaN();
  });
  it("builds a rounded payload", () => {
    const p = toPayload(alignLines(lines, [{ startS: 0.04, text: L(0) }], 20), 20.04);
    expect(p).toMatchObject({ version: 1, duration_s: 20 });
    expect(p.lines[0]).toMatchObject({ i: 0, start_s: 0, sung: true });
  });
});
