import { describe, expect, it } from "vitest";

import { clipFrameState, pickClipWindow, wrapText } from "@/lib/share/clip-plan";
import { pickRecorderMime } from "@/lib/share/clip-export";
import type { SyncLine } from "@/lib/lyrics/sync";

function line(i: number, start: number, end: number, sectionType = "verse", sung = true): SyncLine {
  return { key: `s:${i}`, sectionId: "s", sectionType, lineInSection: i, text: `line ${i}`, start, end, sung };
}

// 8 lines of 8 s each = 64 s track, chorus in the middle.
const lines = Array.from({ length: 8 }, (_, i) => line(i, i * 8, i * 8 + 8, i >= 3 && i <= 5 ? "chorus" : "verse"));

describe("pickClipWindow", () => {
  it("keeps the clip within 15-30 s", () => {
    const w = pickClipWindow(lines, 64);
    expect(w.end - w.start).toBeGreaterThanOrEqual(15);
    expect(w.end - w.start).toBeLessThanOrEqual(30);
  });

  it("starts on a line boundary and prefers the chorus", () => {
    const w = pickClipWindow(lines, 64);
    expect(lines.some((l) => l.start === w.start)).toBe(true);
    expect(w.start).toBeGreaterThanOrEqual(24);
    expect(w.start).toBeLessThanOrEqual(40);
  });

  it("never runs past the end of the track", () => {
    const w = pickClipWindow([line(0, 0, 8), line(1, 8, 20)], 22);
    expect(w.end).toBeLessThanOrEqual(22);
    expect(w.end - w.start).toBeGreaterThanOrEqual(15);
  });

  it("exports a short track whole and an unsynced track from the top", () => {
    expect(pickClipWindow(lines, 12)).toEqual({ start: 0, end: 12 });
    expect(pickClipWindow([], 90)).toEqual({ start: 0, end: 30 });
    expect(pickClipWindow(lines, 0)).toEqual({ start: 0, end: 0 });
  });

  it("weights interpolated lines below heard ones", () => {
    const mixed = [
      line(0, 0, 10, "verse", false), line(1, 10, 20, "verse", false), line(2, 20, 30, "verse", false),
      line(3, 40, 50), line(4, 50, 60), line(5, 60, 70),
    ];
    expect(pickClipWindow(mixed, 70).start).toBeGreaterThanOrEqual(30);
  });
});

describe("clipFrameState", () => {
  const win = { start: 24, end: 48 };
  it("finds the active line and progress", () => {
    const s = clipFrameState(lines, win, 28);
    expect(s.active).toBe(3);
    expect(s.progress).toBeCloseTo(0.5);
    expect(s.clipProgress).toBeCloseTo(4 / 24);
  });
  it("holds the last line through a short gap, then goes blank", () => {
    const gap = [line(0, 0, 5), line(1, 10, 15)];
    expect(clipFrameState(gap, { start: 0, end: 15 }, 5.5).active).toBe(0);
    expect(clipFrameState(gap, { start: 0, end: 15 }, 8).active).toBe(-1);
  });
});

describe("wrapText", () => {
  const measure = (s: string) => Array.from(s).length * 10;
  it("wraps on spaces within the width", () => {
    expect(wrapText(measure, "aa bb cc dd", 50)).toEqual(["aa bb", "cc dd"]);
  });
  it("breaks an over-long word instead of overflowing", () => {
    const out = wrapText(measure, "abcdefghij", 40);
    expect(out.every((l) => measure(l) <= 40)).toBe(true);
    expect(out.join("")).toBe("abcdefghij");
  });
});

describe("pickRecorderMime", () => {
  it("prefers mp4 and falls back to webm", () => {
    expect(pickRecorderMime(() => true)).toMatch(/^video\/mp4/);
    expect(pickRecorderMime((m) => m === "video/webm")).toBe("video/webm");
    expect(pickRecorderMime(() => false)).toBeNull();
  });
});
