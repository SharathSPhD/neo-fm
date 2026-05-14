/**
 * Exports the canonical Zod schema to a JSON Schema file on disk.
 *
 * The TypeScript Zod definition in `src/index.ts` is the single source of
 * truth for the Song Document DSL. This script materialises that schema as
 * `song-doc.schema.json` so non-TS consumers (Python pydantic codegen,
 * OpenAPI tools, IDE validators) can stay in lockstep without re-running
 * a Node toolchain.
 *
 * Run `pnpm --filter @neo-fm/song-doc export-schema` after editing
 * `src/index.ts`; commit the regenerated `song-doc.schema.json`. CI
 * verifies the on-disk schema matches what the Zod source would emit.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { songDocumentJsonSchema } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "song-doc.schema.json");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(songDocumentJsonSchema, null, 2) + "\n",
  "utf8",
);

console.log(`[song-doc] wrote ${outPath}`);
