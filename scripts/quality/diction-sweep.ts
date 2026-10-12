/**
 * Diction sweep: render N frozen lyrics per language with Lyria, have Gemini transcribe the singing, and score
 * matchPct with the production scorer (apps/web/lib/diction). Local spend cap; resumable (results.jsonl).
 *
 *   GEMINI_API_KEY=... npx tsx scripts/quality/diction-sweep.ts --class clip --n 10 --cap-gbp 3 --out quality/clip.jsonl
 *   ... --report quality/clip.jsonl   # summary table only, no spend
 *
 * Lyrics: scripts/quality/lyrics-fullB-n10.json (PCE fullB outputs, first 10 briefs per language, trimmed to 8 lines).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { dictionHints } from "../../apps/web/lib/diction";
import { auditDiction } from "../../apps/web/lib/diction/gemini";
import { estimatedCostGbp, generateMusic, type DurationClass, type SpendGuard } from "../../apps/web/lib/agent/lyria";

interface Item { id: string; language: string; lyrics: string }
interface Rec { id: string; language: string; cls: DurationClass; matchPct: number | null; tailMissing?: number; lineCount?: number; flagged: { line: string; heard: string; cer: number }[]; transcript?: string; error?: string }

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LABEL = /^(hook|verse|chorus|bridge|pallavi|anupallavi|charanam|mukhda|antara|[ऀ-ॿঀ-৿஀-௿ఀ-౿ಀ-೿]{1,12}\s*[\d१-९১-৯]?)\s*(\(.*\))?\s*[:]?$/i;
const SECTION_WORDS = /^(hook|verse|chorus|bridge|pallavi|anupallavi|charanam|lullaby|পল্লবী|হুক|অন্তরা|মুখড়া|मुखड़ा|अंतरा|பல்லவி|சரணம்|పల్లవి|చరణం|ಪಲ್ಲವಿ|ಚರಣ|ಅನುಪಲ್ಲವಿ)/i; // no \b: it is ASCII-only and never matches Indic scripts

/** Drop section headers/markdown; keep only sung lines. */
export function singable(raw: string): string {
  return raw.split("\n").map((l) => l.trim()).filter((l) => {
    if (!l) return false;
    if (/^#/.test(l) || /^\*\*.*\*\*$/.test(l) || /^\[.*\]$/.test(l)) return false;
    const words = l.replace(/[*()\d]/g, "").trim().split(/\s+/);
    return !(words.length <= 3 && SECTION_WORDS.test(words[0]) && !/[,.!?]/.test(l));
  }).join("\n");
}

const STYLE: Record<string, string> = {
  Hindi: "A warm Hindi folk-pop song with acoustic guitar and tabla, expressive female vocal.",
  Tamil: "A warm Tamil folk-pop song with acoustic guitar and mridangam, expressive female vocal.",
  Telugu: "A warm Telugu folk-pop song with acoustic guitar and dholak, expressive female vocal.",
  Kannada: "A warm Kannada bhavageete-pop song with acoustic guitar and tabla, expressive female vocal.",
  Bengali: "A warm Bengali folk-pop song with acoustic guitar and dotara, expressive female vocal.",
};

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

export function report(recs: Rec[]): string {
  const rows = ["| Language | Class | N | Median | p10 | Mean | Failures (<60 or error) |", "|---|---|---|---|---|---|---|"];
  const keys = [...new Set(recs.map((r) => `${r.language}|${r.cls}`))].sort();
  for (const k of keys) {
    const [lang, cls] = k.split("|");
    const rs = recs.filter((r) => r.language === lang && r.cls === cls);
    const ok = rs.filter((r) => r.matchPct !== null).map((r) => r.matchPct as number);
    const fail = rs.length - ok.filter((m) => m >= 60).length;
    rows.push(`| ${lang} | ${cls === "clip" ? "30 s" : "60 s"} | ${rs.length} | ${pct(ok, 0.5)} | ${pct(ok, 0.1)} | ${ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : "-"} | ${fail} |`);
  }
  return rows.join("\n");
}

import { scoreTranscript } from "../../apps/web/lib/diction";

/** Re-score stored transcripts offline (no spend) with the current header filter; adds tail-truncation stats. */
function rescore(recs: Rec[], items: Item[]): Rec[] {
  const by = new Map(items.map((i) => [i.id, i]));
  return recs.map((r) => {
    const it = by.get(r.id);
    if (!it || r.transcript === undefined) return r;
    const sc = scoreTranscript(singable(it.lyrics), r.transcript);
    let tail = 0; for (let i = sc.lines.length - 1; i >= 0 && sc.lines[i].flagged; i--) tail++;
    return { ...r, matchPct: sc.matchPct, tailMissing: tail, lineCount: sc.lines.length, flagged: sc.lines.filter((l) => l.flagged).map((l) => ({ line: l.intended, heard: l.heard, cer: Number(l.cer.toFixed(2)) })) };
  });
}

const load = (f: string): Rec[] => existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Rec) : [];

async function main() {
  const rep = arg("report");
  if (rep) {
    const items = JSON.parse(readFileSync(new URL("./lyrics-fullB-n10.json", import.meta.url), "utf8")) as Item[];
    const rs = rescore(load(rep), items);
    console.log(report(rs));
    const tr = rs.filter((r) => (r.tailMissing ?? 0) > 0);
    console.log(`\nSamples whose last 1+ lines were never sung (clip ran out): ${tr.length}/${rs.length}; of the ${rs.filter((r) => (r.matchPct ?? 100) < 85).length} samples under 85%, ${rs.filter((r) => (r.matchPct ?? 100) < 85 && (r.tailMissing ?? 0) > 0).length} are tail-truncation.`);
    return;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY required");
  const cls = (arg("class", "clip") as DurationClass);
  const n = Number(arg("n", "10"));
  const cap = Number(arg("cap-gbp", "3"));
  const out = arg("out", `quality/${cls}.jsonl`)!;
  const langs = arg("languages")?.split(",");
  const audioDir = arg("save-audio");
  if (audioDir) mkdirSync(audioDir, { recursive: true });
  const perLangCap = arg("per-language");
  mkdirSync(dirname(out), { recursive: true });
  const done = new Set(load(out).filter((r) => r.matchPct !== null).map((r) => r.id));
  const all = JSON.parse(readFileSync(new URL("./lyrics-fullB-n10.json", import.meta.url), "utf8")) as Item[];
  const perLang = new Map<string, number>();
  const work = all.filter((it) => {
    if (langs && !langs.includes(it.language)) return false;
    const c = (perLang.get(it.language) ?? 0) + 1; perLang.set(it.language, c);
    return c <= Number(perLangCap?.split(",").find((x) => x.startsWith(`${it.language}=`))?.split("=")[1] ?? n) && !done.has(it.id);
  });
  let spent = 0;
  const guard: SpendGuard = { reserve: async (a) => (spent + a <= cap ? ((spent += a), true) : false), release: async (a) => { spent -= a; } };
  console.error(`${work.length} renders, est GBP ${(work.length * estimatedCostGbp(cls)).toFixed(2)} (cap ${cap})`);
  const run = async (it: Item) => {
    const lyrics = singable(it.lyrics);
    const base: Rec = { id: it.id, language: it.language, cls, matchPct: null, flagged: [] };
    try {
      const r = await generateMusic({ stylePrompt: `${STYLE[it.language]} ${dictionHints(it.language)}`.trim(), lyrics, durationClass: cls, targetSeconds: cls === "full" ? 60 : undefined }, { guard, apiKey: key });
      if (audioDir) writeFileSync(`${audioDir}/${it.id}.${/wav/.test(r.mimeType) ? "wav" : "mp3"}`, r.audio);
      const qa = await auditDiction(lyrics, r.audio, r.mimeType, it.language.toLowerCase(), key);
      Object.assign(base, { matchPct: qa.matchPct, transcript: qa.transcript, flagged: qa.lines.filter((l) => l.flagged).map((l) => ({ line: l.intended, heard: l.heard, cer: Number(l.cer.toFixed(2)) })) });
    } catch (e) { base.error = String((e as Error).message).slice(0, 200); }
    appendFileSync(out, JSON.stringify(base) + "\n");
    console.error(it.id, base.matchPct ?? base.error);
  };
  const q = [...work];
  await Promise.all(Array.from({ length: 4 }, async () => { for (let it; (it = q.shift());) await run(it); }));
  console.error(`spent ~GBP ${spent.toFixed(2)}`);
  console.log(report(load(out)));
}
if (process.argv[1]?.endsWith("diction-sweep.ts")) main().catch((e) => { console.error(e); process.exit(1); });
