/**
 * Pins `demos/phase-3-request.golden.json` byte-for-byte so CI fails if
 * anyone mutates the Kabir doha entry, the section mapper, the schema, or
 * the translator without rebuilding the golden.
 *
 * To regenerate after an intentional change:
 *
 *     pnpm --filter @neo-fm/lyrics build-phase-3-request
 *
 * The downstream WAV step is documented in demos/phase-3-SMOKE-HANDOFF.md.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildPhase3RequestText } from "./phase3.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..");
const CORPUS = resolve(REPO_ROOT, "data", "public-lyrics");
const GOLDEN = resolve(REPO_ROOT, "demos", "phase-3-request.golden.json");

describe("Phase 3 golden pipeline (offline)", () => {
  it("regenerates demos/phase-3-request.golden.json byte-for-byte", async () => {
    const regenerated = await buildPhase3RequestText({ rootDir: CORPUS });
    const onDisk = readFileSync(GOLDEN, "utf-8");
    expect(regenerated).toBe(onDisk);
  });

  it("structure matches openapi-dgx GenerateRequest", async () => {
    const text = await buildPhase3RequestText({ rootDir: CORPUS });
    const req = JSON.parse(text);
    expect(req.style_family).toBe("hindustani");
    expect(req.target_duration_seconds).toBe(60);
    expect(req.output_format).toBe("wav");
    expect(req.sample_rate).toBe(48000);
    expect(req.sections.length).toBeGreaterThanOrEqual(1);
    for (const s of req.sections) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.target_seconds).toBe("number");
      // Every Phase-3 section carries its lyric body + Devanagari script.
      expect(typeof s.lyrics).toBe("string");
      expect(s.lyrics.length).toBeGreaterThan(0);
      expect(s.script).toBe("devanagari");
    }
  });
});
