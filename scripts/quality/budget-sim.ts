/** Offline check of the clip syllable budget against the stored 30 s sweep (no spend):
 *  npx tsx scripts/quality/budget-sim.ts managed-agents/quality/clip-30s.jsonl
 *  "fixed" = truncated sample whose trimmed lyric is no longer than the portion Lyria actually sang (guaranteed to fit);
 *  "lines lost" = lines dropped from songs that were sung in full (the cost of the cap). */
import { readFileSync } from "node:fs";

import { scoreTranscript } from "../../apps/web/lib/diction";
import { fitToClipBudget, syllables } from "../../apps/web/lib/diction/budget";
import { singable } from "./diction-sweep";

interface Item { id: string; language: string; lyrics: string }
const items = JSON.parse(readFileSync(new URL("./lyrics-fullB-n10.json", import.meta.url), "utf8")) as Item[];
const recs = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; transcript: string });

const rows = recs.map((r) => {
  const it = items.find((i) => i.id === r.id)!;
  const lines = singable(it.lyrics).split("\n");
  const sc = scoreTranscript(lines.join("\n"), r.transcript);
  let tail = 0; for (let i = sc.lines.length - 1; i >= 0 && sc.lines[i].flagged; i--) tail++;
  const sungSyl = sc.lines.slice(0, sc.lines.length - tail).reduce((a, l) => a + syllables(l.intended), 0);
  return { lang: it.language, lines, tail, sungSyl };
});
const truncated = rows.filter((r) => r.tail > 0);
console.log(`truncated samples: ${truncated.length}/${rows.length}\n\n| Budget (syllables) | Truncated fixed | Full songs losing lines | Lines lost in those |\n|---|---|---|---|`);
for (const b of [50, 60, 70, 80, 90, 100, 120]) {
  const fixed = truncated.filter((r) => syllables(fitToClipBudget(r.lines, b).join("\n")) <= r.sungSyl).length;
  const full = rows.filter((r) => r.tail === 0);
  const cut = full.map((r) => r.lines.length - fitToClipBudget(r.lines, b).length).filter((x) => x > 0);
  console.log(`| ${b} | ${fixed}/${truncated.length} | ${cut.length}/${full.length} | ${cut.reduce((a, x) => a + x, 0)} |`);
}
