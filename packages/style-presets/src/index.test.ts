import { describe, expect, it } from "vitest";

import { SongDocumentSchema } from "@neo-fm/song-doc";

import { findPreset, PRESETS } from "./index.js";

describe("style presets", () => {
  it("ships exactly eight curated presets", () => {
    expect(PRESETS).toHaveLength(8);
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
    const first3 = PRESETS.slice(0, 3).map((p) => p.song_document.style_family);
    for (const s of first3) {
      expect(["carnatic", "hindustani", "kannada-folk"]).toContain(s);
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
