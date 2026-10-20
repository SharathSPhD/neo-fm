import { describe, expect, it } from "vitest";

import { beatPulse, clipFrameState, energyEnvelope, pickClipWindow, wrapText } from "@/lib/share/clip-plan";
import { drawClipFrame } from "@/lib/share/clip-render";
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

describe("drawClipFrame occasion", () => {
  function drawn(occasion: string | null): string[] {
    const texts: string[] = [];
    const grad = { addColorStop: () => undefined };
    const ctx = new Proxy({ canvas: { width: 720, height: 1280 } } as Record<string, unknown>, {
      get: (t, k: string) => {
        if (k in t) return t[k];
        if (k === "fillText") return (s: string) => texts.push(s);
        if (k === "measureText") return (s: string) => ({ width: s.length * 10 });
        if (k === "createLinearGradient" || k === "createRadialGradient") return () => grad;
        return () => undefined;
      },
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    drawClipFrame(ctx, {
      lines: [line(0, 0, 5)], window: { start: 0, end: 15 }, t: 1, title: "Geet", to: "For Amma", occasion,
      message: null, cover: null, seed: "s", fontFamily: "sans-serif",
    });
    return texts;
  }
  it("draws the occasion as an eyebrow when the song came from /gift", () => {
    expect(drawn("Diwali")).toContain("DIWALI");
  });
  it("leaves it out otherwise", () => {
    const t = drawn(null);
    expect(t).toContain("Geet");
    expect(t.some((s) => s === s.toUpperCase() && /[A-Z]{4,}/.test(s))).toBe(false);
  });
});

describe("energyEnvelope and beatPulse", () => {
  // 1 s of silence, then 1 s of a loud tone, at 1 kHz and 10 fps.
  const sig = new Float32Array(2000).map((_, i) => (i < 1000 ? 0 : Math.sin(i / 3)));
  it("scales loudness to 0..1 per frame", () => {
    const env = energyEnvelope(sig, 1000, 10);
    expect(env.length).toBe(20);
    expect(env[2]).toBe(0);
    expect(env[15]).toBeGreaterThan(0.9);
    expect(Math.max(...env)).toBeLessThanOrEqual(1);
  });
  it("pulses on the onset and settles after", () => {
    const env = energyEnvelope(sig, 1000, 10);
    expect(beatPulse(env, 10, 10)).toBeGreaterThan(0.5);
    expect(beatPulse(env, 19, 10)).toBeLessThan(0.1);
  });
  it("is flat for silence and empty input", () => {
    expect(Math.max(...energyEnvelope(new Float32Array(500), 1000, 10))).toBe(0);
    expect(beatPulse(new Float32Array(0), 3, 10)).toBe(0);
  });
});

describe("drawClipFrame karaoke", () => {
  it("paints the active line a second time for the sung share", () => {
    const texts: string[] = [];
    const grad = { addColorStop: () => undefined };
    const ctx = new Proxy({ canvas: { width: 720, height: 1280 } } as Record<string, unknown>, {
      get: (t, k: string) => {
        if (k in t) return t[k];
        if (k === "fillText") return (s: string) => texts.push(s);
        if (k === "measureText") return (s: string) => ({ width: s.length * 10 });
        if (k === "createLinearGradient" || k === "createRadialGradient") return () => grad;
        return () => undefined;
      },
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    const base = { lines: [line(0, 0, 10)], window: { start: 0, end: 15 }, title: "T", to: null, occasion: null, message: null, cover: null, seed: "s", fontFamily: "x" };
    drawClipFrame(ctx, { ...base, t: 0 });
    const idle = texts.filter((s) => s === "line 0").length;
    texts.length = 0;
    drawClipFrame(ctx, { ...base, t: 5 });
    expect(texts.filter((s) => s === "line 0").length).toBe(idle + 1);
  });
});
