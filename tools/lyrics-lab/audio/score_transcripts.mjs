#!/usr/bin/env node
// Scores local-ASR transcripts against intended lyrics with the SAME functions production uses
// (apps/web/lib/diction: scoreTranscript, scoreTranscriptUnordered, gate verdict), so numbers are comparable to the
// Gemini-scored qaDiction values. Needs `pnpm install` for esbuild.
// usage: node score_transcripts.mjs transcripts.json out.json
//   transcripts.json: [{id, language, lyrics, transcript, romanized?}]  (transcript in the sung script)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const req = createRequire(path.join(root, "node_modules/.pnpm/node_modules/"));
const esbuild = req("esbuild");
const dir = mkdtempSync(path.join(tmpdir(), "diction-"));
const outfile = path.join(dir, "d.mjs");
esbuild.buildSync({
  stdin: {
    contents: `export * from "./apps/web/lib/diction/index"; export * from "./apps/web/lib/diction/gate";`,
    resolveDir: root, loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", outfile, logLevel: "error",
});
const d = await import(pathToFileURL(outfile).href);

const [inp, outp] = process.argv.slice(2);
if (!inp || !outp) { console.error("usage: score_transcripts.mjs transcripts.json out.json"); process.exit(2); }
const rows = JSON.parse(readFileSync(inp, "utf8"));
const out = rows.map((r) => {
  const g = d.gateTranscript(r.lyrics, r.transcript ?? "");
  return { id: r.id, language: r.language, matchPct: g.matchPct, unorderedPct: g.unorderedPct, verdict: g.verdict, reordered: g.reordered, tailUnsung: g.tailUnsung };
});
writeFileSync(outp, JSON.stringify(out, null, 1));
console.log(`scored ${out.length}; verdicts`, out.reduce((a, o) => ((a[o.verdict] = (a[o.verdict] ?? 0) + 1), a), {}));
