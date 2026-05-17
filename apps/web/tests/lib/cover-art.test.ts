/**
 * Unit tests for components/cover-art's coverGradient helper (Sprint 6.2).
 *
 * coverGradient is the deterministic fallback that paints song cards
 * before a renderer-produced cover-art row arrives. The contract:
 *
 *   - same (seed, styleFamily) always yields the same gradient string
 *     (so SSR/CSR never mismatch and realtime re-renders don't pop)
 *   - the hue lands in the family-biased band (carnatic→saffron,
 *     hindustani→indigo, etc.) but seed jitter keeps adjacent cards
 *     from looking identical
 *   - the output is always a valid CSS linear-gradient string
 */
import { describe, expect, it } from "vitest";

import { coverGradient } from "../../components/cover-art";

const HSL_RE =
  /^linear-gradient\(135deg, hsl\((\d+(?:\.\d+)?), 55%, 32%\), hsl\((\d+(?:\.\d+)?), 60%, 18%\)\)$/;

describe("coverGradient", () => {
  it("returns a valid CSS linear-gradient string", () => {
    const g = coverGradient("seed-1", "western");
    expect(g).toMatch(HSL_RE);
  });

  it("is deterministic for the same (seed, styleFamily)", () => {
    const a = coverGradient("abc-def-ghi", "carnatic");
    const b = coverGradient("abc-def-ghi", "carnatic");
    expect(a).toBe(b);
  });

  it("changes when the seed changes", () => {
    const a = coverGradient("seed-A", "western");
    const b = coverGradient("seed-B", "western");
    expect(a).not.toBe(b);
  });

  it("changes when the styleFamily changes", () => {
    const a = coverGradient("same-seed", "carnatic");
    const b = coverGradient("same-seed", "hindustani");
    expect(a).not.toBe(b);
  });

  it("falls back to a neutral hue for an unknown style", () => {
    const g = coverGradient("seed-x", "made-up-style");
    const m = g.match(HSL_RE);
    expect(m).not.toBeNull();
    const hueA = Number(m![1]);
    // Default hue for unknown style is 280 (aubergine); within ±14
    // jitter, expect 266..294 with wrap-around handled by the helper.
    expect(hueA).toBeGreaterThanOrEqual(266);
    expect(hueA).toBeLessThanOrEqual(294);
  });

  it("biases carnatic toward the saffron band (~24°)", () => {
    const samples = [
      "c-1",
      "c-2",
      "c-3",
      "c-4",
      "c-5",
      "c-6",
      "c-7",
      "c-8",
    ].map((s) => Number(coverGradient(s, "carnatic").match(HSL_RE)![1]));
    // base hue is 24, jitter ±14 → expect every sample in 10..38 mod 360
    for (const h of samples) {
      const folded = h > 180 ? 360 - h : h; // distance from 0 in either direction
      expect(Math.abs(folded - 24)).toBeLessThanOrEqual(14);
    }
  });

  it("handles empty seeds without crashing", () => {
    expect(() => coverGradient("", "western")).not.toThrow();
    expect(coverGradient("", "western")).toMatch(HSL_RE);
  });

  // v1.3 Sprint 2: bhavageete + Tamil folk got their own hue bands
  // so the gallery visually distinguishes them from generic folk.
  it("biases kannada-light-classical toward magenta-rose (~320°)", () => {
    const samples = [
      "k-1",
      "k-2",
      "k-3",
      "k-4",
      "k-5",
    ].map(
      (s) =>
        Number(
          coverGradient(s, "kannada-light-classical").match(HSL_RE)![1],
        ),
    );
    for (const h of samples) {
      // base 320, ±14 jitter → 306..334 mod 360
      const delta = Math.min(
        Math.abs(h - 320),
        Math.abs(h - 320 + 360),
        Math.abs(h - 320 - 360),
      );
      expect(delta).toBeLessThanOrEqual(14);
    }
  });

  it("biases tamil-folk toward warm vermillion (~8°)", () => {
    const samples = [
      "t-1",
      "t-2",
      "t-3",
      "t-4",
      "t-5",
    ].map(
      (s) => Number(coverGradient(s, "tamil-folk").match(HSL_RE)![1]),
    );
    for (const h of samples) {
      const folded = h > 180 ? 360 - h : h;
      expect(Math.abs(folded - 8)).toBeLessThanOrEqual(14);
    }
  });
});
