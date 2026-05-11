import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildPhase2RequestText } from "./phase2.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..");
const FIXTURE = resolve(
  REPO_ROOT,
  "packages",
  "song-doc",
  "fixtures",
  "western-pop-3sec.json",
);
const GOLDEN = resolve(REPO_ROOT, "demos", "phase-2-request.golden.json");

describe("Phase 2 golden pipeline (offline)", () => {
  it("regenerates demos/phase-2-request.golden.json byte-for-byte", async () => {
    const regenerated = await buildPhase2RequestText(FIXTURE);
    const onDisk = readFileSync(GOLDEN, "utf-8");
    expect(regenerated).toBe(onDisk);
  });

  it("contains a GenerateRequest the music-inference openapi-dgx contract accepts", async () => {
    const text = await buildPhase2RequestText(FIXTURE);
    const req = JSON.parse(text);
    expect(req.style_family).toBe("western");
    expect(req.target_duration_seconds).toBe(180);
    expect(req.sections.length).toBeGreaterThanOrEqual(1);
    expect(req.output_format).toBe("wav");
    expect(req.sample_rate).toBe(48000);
    for (const s of req.sections) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.target_seconds).toBe("number");
      expect(Array.isArray(s.tags)).toBe(true);
      // Every section gets the composer-emitted style + key tags.
      expect(s.tags).toContain("style:western");
      expect(s.tags).toContain("key:C");
    }
  });
});
