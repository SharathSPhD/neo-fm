import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SongDocumentSchema } from "./index.js";

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
});
