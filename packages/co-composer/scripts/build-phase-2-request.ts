/**
 * Phase 2 golden pipeline (offline portion):
 *
 *   packages/song-doc/fixtures/western-pop-3sec.json
 *     -> WesternCoComposer.elaborate()
 *     -> translate(SongDocument -> GenerateRequest)
 *     -> demos/phase-2-request.golden.json
 *
 * Pure delegation to `src/phase2.ts` so the test suite can call the same
 * builder in-process without a child shell. The on-DGX portion of the
 * demo (`scripts/build-demo.sh phase-2`) reads the golden JSON, signs it
 * with the music-inference HMAC, POSTs to /v1/generate, and captures the
 * resulting WAV at demos/phase-2.wav.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPhase2RequestText } from "../src/phase2.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..");
const FIXTURE = resolve(
  REPO_ROOT,
  "packages",
  "song-doc",
  "fixtures",
  "western-pop-3sec.json",
);
const OUT = resolve(REPO_ROOT, "demos", "phase-2-request.golden.json");

async function main(): Promise<void> {
  const text = await buildPhase2RequestText(FIXTURE);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text, "utf-8");
  console.log(`[phase-2] wrote ${OUT}`);
}

await main();
