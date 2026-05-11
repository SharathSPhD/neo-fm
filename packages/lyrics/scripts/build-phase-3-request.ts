/**
 * Builds the Phase 3 golden GenerateRequest from the Kabir doha entry.
 *
 * Pipeline:
 *   data/public-lyrics/hi/kabir-pothi.md
 *     -> PublicLyricsLibraryProvider.generate(...)
 *     -> SongDocument
 *     -> songDocToGenerateRequest()
 *     -> demos/phase-3-request.golden.json
 *
 * The downstream WAV (`demos/phase-3.wav`) is produced by handing this JSON
 * to `music-inference /v1/generate` on the DGX — see
 * `demos/phase-3-SMOKE-HANDOFF.md` for the operator runbook.
 *
 * This script is invoked by `pnpm --filter @neo-fm/lyrics build-phase-3-request`
 * and its output is byte-pinned by `lyrics/src/phase3.test.ts` so CI catches
 * drift.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPhase3RequestText } from "../src/phase3.js";
import { writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..");
const OUT = resolve(REPO_ROOT, "demos", "phase-3-request.golden.json");

async function main(): Promise<number> {
  const text = await buildPhase3RequestText({
    rootDir: resolve(REPO_ROOT, "data", "public-lyrics"),
  });
  writeFileSync(OUT, text, "utf-8");
  console.log(`[phase-3] wrote ${OUT}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
