import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LYRIC_PER_SECTION_MAX_CHARS,
  LYRIC_TOTAL_MAX_CHARS,
  SongDocumentSchema,
  allocateSectionDurations,
  detectBlockedLyricTerms,
} from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

describe("SongDocumentSchema", () => {
  it("has fixtures to validate", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const file of fixtureFiles) {
    it(`parses fixture ${file}`, () => {
      const raw = JSON.parse(readFileSync(join(fixturesDir, file), "utf-8"));
      const parsed = SongDocumentSchema.parse(raw);
      expect(parsed.sections.length).toBeGreaterThan(0);
    });
  }

  it("rejects a Carnatic doc with a Hindustani raga.system", () => {
    const bad = {
      language: "kn",
      style_family: "carnatic",
      target_duration_seconds: 90,
      sections: [
        { id: "s1", type: "pallavi", target_seconds: 30, lyrics: "..." },
      ],
      raga: { name: "yaman", system: "hindustani" },
    };
    expect(() => SongDocumentSchema.parse(bad)).toThrow();
  });

  it("rejects a section longer than 360s", () => {
    const bad = {
      language: "en",
      style_family: "western",
      target_duration_seconds: 180,
      sections: [{ id: "s1", type: "intro", target_seconds: 999 }],
    };
    expect(() => SongDocumentSchema.parse(bad)).toThrow();
  });

  it("rejects when sum(section.target_seconds) != target_duration_seconds", () => {
    const bad = {
      language: "en",
      style_family: "western",
      target_duration_seconds: 90,
      sections: [
        { id: "a", type: "intro", target_seconds: 20 },
        { id: "b", type: "verse", target_seconds: 20 },
      ],
    };
    expect(() => SongDocumentSchema.parse(bad)).toThrow(/sum/);
  });

  it(`rejects a section with lyrics > ${LYRIC_PER_SECTION_MAX_CHARS} chars`, () => {
    const big = "x".repeat(LYRIC_PER_SECTION_MAX_CHARS + 1);
    const bad = {
      language: "en",
      style_family: "western",
      target_duration_seconds: 30,
      sections: [
        { id: "s1", type: "intro", target_seconds: 30, lyrics: big },
      ],
    };
    expect(() => SongDocumentSchema.parse(bad)).toThrow();
  });

  it(`rejects a doc whose total lyrics > ${LYRIC_TOTAL_MAX_CHARS} chars`, () => {
    // 5 sections * 900 chars = 4500 > 4000 cap; each section < per-section cap
    const oneSection = (id: string) => ({
      id,
      type: "verse",
      target_seconds: 18,
      lyrics: "x".repeat(900),
    });
    const bad = {
      language: "en",
      style_family: "western",
      target_duration_seconds: 90,
      sections: [
        oneSection("s1"),
        oneSection("s2"),
        oneSection("s3"),
        oneSection("s4"),
        oneSection("s5"),
      ],
    };
    expect(() => SongDocumentSchema.parse(bad)).toThrow(/LYRIC_TOTAL_MAX_CHARS/);
  });

  it("rejects a doc whose lyrics hit the blocklist", () => {
    const bad = {
      language: "en",
      style_family: "western",
      target_duration_seconds: 30,
      sections: [
        {
          id: "s1",
          type: "verse",
          target_seconds: 30,
          lyrics: "Please go and kill yourself today",
        },
      ],
    };
    expect(() => SongDocumentSchema.parse(bad)).toThrow(/blocked terms/);
  });

  it("accepts a doc whose lyrics don't hit the blocklist", () => {
    const good = {
      language: "en",
      style_family: "western",
      target_duration_seconds: 30,
      sections: [
        {
          id: "s1",
          type: "verse",
          target_seconds: 30,
          lyrics: "A bright morning, a song to sing along",
        },
      ],
    };
    expect(() => SongDocumentSchema.parse(good)).not.toThrow();
  });

  it("detectBlockedLyricTerms is case-insensitive", () => {
    expect(detectBlockedLyricTerms("Please CoMmIt SuIcIdE")).toContain(
      "commit suicide",
    );
    expect(detectBlockedLyricTerms("a friendly song")).toEqual([]);
  });
});

describe("allocateSectionDurations", () => {
  it("fills unset section seconds evenly", () => {
    const input = {
      language: "en" as const,
      style_family: "western" as const,
      target_duration_seconds: 90 as const,
      sections: [
        { id: "a", type: "intro" as const },
        { id: "b", type: "verse" as const },
        { id: "c", type: "outro" as const },
      ],
    };
    const allocated = allocateSectionDurations(input);
    const sum = allocated.sections.reduce(
      (acc, s) => acc + s.target_seconds,
      0,
    );
    expect(sum).toBe(90);
    expect(SongDocumentSchema.parse(allocated)).toBeTruthy();
  });

  it("respects fixed seconds and only fills the rest", () => {
    const input = {
      language: "en" as const,
      style_family: "western" as const,
      target_duration_seconds: 90 as const,
      sections: [
        { id: "a", type: "intro" as const, target_seconds: 10 },
        { id: "b", type: "verse" as const },
        { id: "c", type: "verse" as const },
        { id: "d", type: "outro" as const, target_seconds: 10 },
      ],
    };
    const allocated = allocateSectionDurations(input);
    expect(allocated.sections[0].target_seconds).toBe(10);
    expect(allocated.sections[3].target_seconds).toBe(10);
    expect(
      allocated.sections[1].target_seconds + allocated.sections[2].target_seconds,
    ).toBe(70);
  });

  it("throws when fixed seconds already exceed the total", () => {
    expect(() =>
      allocateSectionDurations({
        language: "en" as const,
        style_family: "western" as const,
        target_duration_seconds: 30 as const,
        sections: [
          { id: "a", type: "intro" as const, target_seconds: 25 },
          { id: "b", type: "verse" as const, target_seconds: 25 },
        ],
      }),
    ).toThrow(/exceeds/);
  });
});
