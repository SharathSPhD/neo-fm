/**
 * Text-only A/B of a polish-template candidate against the live default (no Lyria spend).
 * Usage: npx tsx scripts/quality/polish-ab.mts --candidate managed-agents/candidates/polish-tail-safe.md --per-language 4 --out quality/polish-ab.jsonl
 * Both arms polish the SAME stored lyric; metrics are deterministic (aksharas, lines, whether the last line repeats an earlier one),
 * plus a blind pairwise judge (Claude and Gemini, position randomised). Two paid text-API calls per arm, one per judge.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import { aksharas, charErrorRate } from "../../apps/web/lib/diction";
import { geminiInteract, geminiQaModel } from "../../apps/web/lib/gemini/interactions";
import { DEFAULT_POLISH_TEMPLATE, polishLyrics, validatePolishTemplate } from "../../apps/web/lib/lyrics/polish";
import { singableLines } from "../../apps/web/lib/lyrics/singable";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const cand = readFileSync(arg("candidate", "managed-agents/candidates/polish-tail-safe.md")!, "utf8").trim();
const bad = validatePolishTemplate(cand);
if (bad) throw new Error(`candidate invalid: ${bad}`);
const out = arg("out", "quality/polish-ab.jsonl")!;
const per = Number(arg("per-language", "4"));
mkdirSync(dirname(out), { recursive: true });
const done = new Set(existsSync(out) ? readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).id as string) : []);
const items = JSON.parse(readFileSync(new URL("./lyrics-fullB-n10.json", import.meta.url), "utf8")) as { id: string; language: string; lyrics: string }[];
const seen = new Map<string, number>();
const work = items.filter((it) => { const c = (seen.get(it.language) ?? 0) + 1; seen.set(it.language, c); return c <= per && !done.has(it.id); });

const client = new Anthropic({ apiKey: process.env.MA_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY });
const gkey = process.env.GEMINI_API_KEY;

function metrics(lyrics: string) {
  const lines = singableLines(lyrics);
  const ak = lines.reduce((s, l) => s + aksharas(l).length, 0);
  const last = lines[lines.length - 1] ?? "";
  const norm = (t: string) => t.normalize("NFC").replace(/[\p{P}\p{S}\s]+/gu, "");
  const lastRepeats = lines.slice(0, -1).some((l) => charErrorRate(norm(l), norm(last)) <= 0.3);
  return { lines: lines.length, aksharas: ak, lastRepeats, unique: new Set(lines.map(norm)).size };
}

const JUDGE = (lang: string, a: string, b: string) => `Two candidate song lyrics in ${lang} for the same song. Judge as a native lyricist: imagery, natural diction, and how well it would sing (prosody). Ignore which is longer.
--- LYRIC 1 ---
${a}
--- LYRIC 2 ---
${b}
Reply with JSON only: {"overall":"1"|"2"|"tie","prosody":"1"|"2"|"tie"}`;
async function judgeClaude(lang: string, a: string, b: string) {
  const r = await client.messages.create({ model: "claude-sonnet-5-5", max_tokens: 200, messages: [{ role: "user", content: JUDGE(lang, a, b) }] });
  return parse(r.content.map((c) => (c.type === "text" ? c.text : "")).join(""));
}
async function judgeGemini(lang: string, a: string, b: string) {
  if (!gkey) return null;
  try {
    const r = await geminiInteract({ apiKey: gkey, model: geminiQaModel(), json: true, text: JUDGE(lang, a, b) });
    return parse(r.text);
  } catch { return null; }
}
function parse(t: string): { overall: string; prosody: string } | null {
  const m = t.match(/\{[\s\S]*\}/); if (!m) return null;
  try { const o = JSON.parse(m[0]) as { overall?: string; prosody?: string }; return { overall: String(o.overall), prosody: String(o.prosody) }; } catch { return null; }
}

for (const it of work) {
  try {
    const a = { language: it.language, style: "devotional/folk", brief: "(the same theme and imagery as the draft)", lyrics: it.lyrics };
    const [A, B] = await Promise.all([polishLyrics(client, a, DEFAULT_POLISH_TEMPLATE), polishLyrics(client, a, cand)]);
    const flip = Math.random() < 0.5; // B shown first when flip
    const [x, y] = flip ? [B, A] : [A, B];
    const [jc, jg] = await Promise.all([judgeClaude(it.language, x, y), judgeGemini(it.language, x, y)]);
    // map "1"/"2" back to arm
    const arm = (v: string | undefined) => (v === "tie" || !v ? "tie" : (v === "1") === flip ? "B" : "A");
    const rec = { id: it.id, language: it.language, A: metrics(A), B: metrics(B), claude: jc && { overall: arm(jc.overall), prosody: arm(jc.prosody) }, gemini: jg && { overall: arm(jg.overall), prosody: arm(jg.prosody) }, textA: A, textB: B };
    appendFileSync(out, JSON.stringify(rec) + "\n");
    console.error(it.id, JSON.stringify({ A: rec.A.aksharas, B: rec.B.aksharas, c: rec.claude?.overall, g: rec.gemini?.overall }));
  } catch (e) { console.error(it.id, "error", String((e as Error).message).slice(0, 160)); }
}
