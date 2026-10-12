import { describe, expect, it } from "vitest";

import { loadFontsFor, shapeLine } from "@/lib/share/shape";

describe("share card shaping", () => {
  it("shapes Telugu and Kannada conjuncts into a path", async () => {
    for (const line of ["ప్రేమ స్వప్నం", "ಪ್ರೀತಿ ಸ್ನೇಹ"]) {
      const out = await shapeLine(line, 40);
      expect(out).not.toBeNull();
      expect(out!.width).toBeGreaterThan(100);
      expect(out!.d.startsWith("M")).toBe(true);
    }
  });

  it("skips Latin text", async () => {
    expect(await shapeLine("hello", 40)).toBeNull();
  });

  it("bundled fallback fonts load for every Indic script", async () => {
    for (const t of ["नमस्ते", "বাংলা", "தமிழ்", "తెలుగు", "ಕನ್ನಡ"]) {
      expect((await loadFontsFor(t)).length).toBe(1);
    }
    expect(await loadFontsFor("english")).toEqual([]);
  });
});
