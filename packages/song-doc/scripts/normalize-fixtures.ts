/**
 * Parses every fixture under `fixtures/` through `SongDocumentSchema` and
 * prints a normalised JSON document (sorted keys, no formatting noise) to
 * stdout, one fixture per line as:
 *
 *   {fixture-name}\t{normalised-json}
 *
 * The Python equivalent at `python/tests/parity_dump.py` produces an
 * identical text stream. The CI parity job diffs them; any difference is a
 * Zod/pydantic drift bug and fails the build.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SongDocumentSchema } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

const files = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(fixturesDir, file), "utf-8"));
  const parsed = SongDocumentSchema.parse(raw);
  process.stdout.write(`${file}\t${stableStringify(parsed)}\n`);
}
