import { describe, expect, it } from "vitest";

import { SongDocumentSchema } from "@neo-fm/song-doc";

import { findPreset, PRESETS } from "./index.js";

describe("style presets", () => {
  it("ships exactly nine curated presets", () => {
    // v1.4 Sprint 14 adds the Sanskrit-shloka chant preset; the
    // gallery grows from 8 -> 9 cards. The earlier "eight" assertion
    // pinned the v1.3 gallery shape.
    expect(PRESETS).toHaveLength(9);
  });

  it("includes the Sanskrit shloka preset (Sprint 14)", () => {
    const shloka = findPreset("sanskrit-shloka");
    expect(shloka).toBeDefined();
    expect(shloka?.song_document.style_family).toBe("sanskrit-shloka");
    expect(shloka?.song_document.language).toBe("sa");
    const types = shloka?.song_document.sections.map((s) => s.type) ?? [];
    expect(types).toContain("shloka_verse");
    expect(types).toContain("shloka_refrain");
    expect(types).toContain("phalashruti");
  });

  it("every preset has a unique id", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every preset's song_document parses cleanly through Zod", () => {
    for (const preset of PRESETS) {
      expect(() => SongDocumentSchema.parse(preset.song_document)).not.toThrow();
    }
  });

  it("every preset surfaces a non-empty title, subtitle, description, and chips[]", () => {
    for (const p of PRESETS) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.subtitle.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.chips.length).toBeGreaterThan(0);
    }
  });

  it("the first three presets are Indian-origin styles (Indian-first ordering)", () => {
    // v1.3 Sprint 2 split bhavageete out of kannada-folk; the third
    // card is now Kannada light-classical instead. All three remain
    // Indian-origin, satisfying the "India-first" gallery contract.
    const indianStyles = [
      "carnatic",
      "hindustani",
      "kannada-folk",
      "kannada-light-classical",
      "tamil-folk",
    ];
    const first3 = PRESETS.slice(0, 3).map(
      (p) => p.song_document.style_family,
    );
    for (const s of first3) {
      expect(indianStyles).toContain(s);
    }
  });

  it("findPreset round-trips by id", () => {
    for (const p of PRESETS) {
      expect(findPreset(p.id)).toBe(p);
    }
    expect(findPreset("does-not-exist")).toBeUndefined();
  });

  it("presets with a lyric_source actually embed text in at least one section", () => {
    for (const p of PRESETS) {
      if (!p.lyric_source) continue;
      const hasLyric = p.song_document.sections.some(
        (s) => typeof s.lyrics === "string" && s.lyrics.length > 0,
      );
      expect(hasLyric).toBe(true);
    }
  });
});
