/**
 * Arm C of the clip-length experiment: for 30 s songs whose last lines were never sung, re-render ONCE with the lyric
 * trimmed to the lines that were sung, and score again. Spends ~GBP 0.05 per truncated song.
 *   GEMINI_API_KEY=... npx tsx scripts/quality/adaptive-rerender.mts managed-agents/quality/clip-30s.jsonl <out.jsonl> [--cap-gbp 0.4]
 */
import { appendFileSync, readFileSync } from "node:fs";

import { dictionHints, scoreTranscript } from "../../apps/web/lib/diction";
import { auditDiction } from "../../apps/web/lib/diction/gemini";
import { generateMusic, type SpendGuard } from "../../apps/web/lib/agent/lyria";
import { singable } from "./diction-sweep";

const [inFile, outFile] = process.argv.slice(2);
const capIdx = process.argv.indexOf("--cap-gbp");
const cap = capIdx > 0 ? Number(process.argv[capIdx + 1]) : 0.4;
const key = process.env.GEMINI_API_KEY!;
const items = JSON.parse(readFileSync(new URL("./lyrics-fullB-n10.json", import.meta.url), "utf8")) as { id: string; language: string; lyrics: string }[];
let spent = 0;
const guard: SpendGuard = { reserve: async (a) => (spent + a <= cap ? ((spent += a), true) : false), release: async (a) => { spent -= a; } };
const STYLE = (l: string) => `A warm ${l} folk-pop song with acoustic guitar and percussion, expressive female vocal. ${dictionHints(l)}`.trim();

for (const line of readFileSync(inFile!, "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(line) as { id: string; language: string; transcript: string };
  const it = items.find((i) => i.id === r.id)!;
  const lines = singable(it.lyrics).split("\n");
  const sc = scoreTranscript(lines.join("\n"), r.transcript);
  let tail = 0; for (let i = sc.lines.length - 1; i >= 0 && sc.lines[i]!.flagged; i--) tail++;
  if (tail === 0) continue;
  const kept = lines.slice(0, Math.max(3, lines.length - tail));
  const res = await generateMusic({ stylePrompt: STYLE(it.language), lyrics: kept.join("\n"), durationClass: "clip" }, { guard, apiKey: key });
  const qa = await auditDiction(kept.join("\n"), res.audio, res.mimeType, it.language.toLowerCase(), key);
  const rec = { id: r.id, language: it.language, beforePct: sc.matchPct, linesBefore: lines.length, linesAfter: kept.length, afterPct: qa.matchPct, flagged: qa.lines.filter((l) => l.flagged).length };
  console.log(JSON.stringify(rec));
  appendFileSync(outFile!, JSON.stringify(rec) + "\n");
}
console.error(`spent ~GBP ${spent.toFixed(2)}`);
