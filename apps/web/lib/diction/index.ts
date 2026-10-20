/**
 * Diction layer: deterministic Indic script handling (akshara segmentation, guru/laghu weight),
 * transcript-vs-lyrics scoring for post-render audio QA, and per-language pronunciation hints for
 * the Lyria style prompt. No network; the Gemini transcription call lives in ./gemini.ts.
 */

import { expansionLanguage } from "../languages/registry";

export type Script =
  | "devanagari" | "bengali" | "gurmukhi" | "gujarati" | "odia" | "tamil" | "telugu" | "kannada" | "malayalam" | "latin" | "other";

const BLOCKS: { script: Script; start: number }[] = [
  { script: "devanagari", start: 0x0900 }, { script: "bengali", start: 0x0980 }, { script: "gurmukhi", start: 0x0a00 },
  { script: "gujarati", start: 0x0a80 }, { script: "odia", start: 0x0b00 }, { script: "tamil", start: 0x0b80 },
  { script: "telugu", start: 0x0c00 }, { script: "kannada", start: 0x0c80 }, { script: "malayalam", start: 0x0d00 },
];

function blockOf(cp: number): { script: Script; off: number } | null {
  for (const b of BLOCKS) if (cp >= b.start && cp < b.start + 0x80) return { script: b.script, off: cp - b.start };
  return null;
}

export function detectScript(text: string): Script {
  const counts = new Map<Script, number>();
  for (const ch of text) {
    const b = blockOf(ch.codePointAt(0)!);
    if (b) counts.set(b.script, (counts.get(b.script) ?? 0) + 1);
    else if (/[A-Za-z]/.test(ch)) counts.set("latin", (counts.get("latin") ?? 0) + 1);
  }
  let best: Script = "other"; let n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

// Offsets are parallel across the Brahmic Unicode blocks.
const isModifier = (o: number) => o >= 0x01 && o <= 0x03;                 // candrabindu, anusvara, visarga
const isIndepVowel = (o: number) => o >= 0x05 && o <= 0x14;
const isConsonant = (o: number) => o >= 0x15 && o <= 0x39;
const isVirama = (o: number) => o === 0x4d;
const isVowelSign = (o: number) => (o >= 0x3e && o <= 0x4c) || o === 0x3c /* nukta handled below */;
const LONG_SIGNS = new Set([0x3e, 0x40, 0x42, 0x44, 0x47, 0x48, 0x4a, 0x4b, 0x4c]);
const LONG_INDEP = new Set([0x06, 0x08, 0x0a, 0x0c, 0x0f, 0x10, 0x13, 0x14]);

export interface Akshara { text: string; guru: boolean; conjunct: boolean }

/** Splits Indic text into aksharas (orthographic syllables); non-Indic characters are ignored. */
export function aksharas(text: string): Akshara[] {
  const cps = Array.from(text.normalize("NFC"), (c) => c.codePointAt(0)!);
  const out: Akshara[] = [];
  let i = 0;
  while (i < cps.length) {
    const b = blockOf(cps[i]!);
    if (!b || !(isConsonant(b.off) || isIndepVowel(b.off))) { i++; continue; }
    const start = i; let guru = false; let conjunct = false;
    if (isIndepVowel(b.off)) {
      if (LONG_INDEP.has(b.off)) guru = true;
      i++;
    } else {
      i++;
      // consonant (nukta)? (virama consonant)*
      for (;;) {
        const n = cps[i] !== undefined ? blockOf(cps[i]!) : null;
        if (n && n.off === 0x3c) { i++; continue; }             // nukta
        if (n && isVirama(n.off) && cps[i + 1] !== undefined) {
          const m = blockOf(cps[i + 1]!);
          if (m && isConsonant(m.off)) { conjunct = true; i += 2; continue; }
          i++; break;                                           // trailing virama (pulli / halant): no vowel
        }
        break;
      }
      const v = cps[i] !== undefined ? blockOf(cps[i]!) : null;
      if (v && isVowelSign(v.off) && v.off !== 0x3c) { if (LONG_SIGNS.has(v.off)) guru = true; i++; }
    }
    for (;;) {
      const m = cps[i] !== undefined ? blockOf(cps[i]!) : null;
      if (m && isModifier(m.off)) { if (m.off !== 0x01) guru = true; i++; } else break;
    }
    out.push({ text: String.fromCodePoint(...cps.slice(start, i)), guru, conjunct });
  }
  // A syllable before a conjunct is heavy by position.
  for (let k = 0; k + 1 < out.length; k++) if (out[k + 1]!.conjunct) out[k]!.guru = true;
  return out;
}

export function lineProsody(line: string): { count: number; pattern: string; matra: number } {
  const a = aksharas(line);
  const pattern = a.map((x) => (x.guru ? "G" : "L")).join("");
  return { count: a.length, pattern, matra: a.reduce((s, x) => s + (x.guru ? 2 : 1), 0) };
}

const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

function levenshtein(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

/** Character error rate over normalised code points (punctuation/space/case ignored). */
export function charErrorRate(reference: string, hypothesis: string): number {
  const r = Array.from(norm(reference)); const h = Array.from(norm(hypothesis));
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  return Math.min(1, levenshtein(r, h) / r.length);
}

export interface LineScore { intended: string; heard: string; cer: number; flagged: boolean }
export interface DictionScore { lines: LineScore[]; overall: number; matchPct: number }

/**
 * Aligns each intended line to the best window of the transcript (the singer may merge/split lines) and
 * flags lines whose CER exceeds `threshold`.
 */
export function scoreTranscript(intended: string, transcript: string, threshold = 0.35): DictionScore {
  // Section tags like [Pallavi] / [Chorus] are structure, not sung words.
  const want = intended.split(/\n+/).map((l) => l.replace(/\[[^\]]*\]/g, "").trim()).filter((l) => norm(l).length > 0);
  const heardChars = Array.from(norm(transcript));
  const lines: LineScore[] = [];
  let cursor = 0;
  for (const line of want) {
    const len = Array.from(norm(line)).length;
    let best = { cer: 1, start: cursor, end: Math.min(heardChars.length, cursor + len) };
    const lo = Math.max(0, cursor - Math.ceil(len * 0.3));
    const hi = Math.min(heardChars.length, cursor + Math.ceil(len * 0.6));
    for (let s = lo; s <= hi; s++) {
      for (const w of [Math.floor(len * 0.8), len, Math.ceil(len * 1.2)]) {
        const e = Math.min(heardChars.length, s + w);
        const cer = charErrorRate(line, heardChars.slice(s, e).join(""));
        if (cer < best.cer) best = { cer, start: s, end: e };
      }
    }
    cursor = best.end;
    lines.push({ intended: line, heard: heardChars.slice(best.start, best.end).join(""), cer: best.cer, flagged: best.cer > threshold });
  }
  const overall = lines.length ? lines.reduce((s, l) => s + l.cer, 0) / lines.length : 0;
  return { lines, overall, matchPct: Math.round((1 - overall) * 100) };
}

const HINTS: Record<string, string> = {
  kannada: "Sing Kannada with crisp retroflex consonants (ಟ ಡ ಣ ಳ), clearly distinct aspirates (ಖ ಘ ಛ ಝ), short/long vowels held to their length, and the final -u kept soft but audible; no Hindi-style schwa deletion.",
  tamil: "Sing Tamil with the retroflex approximant ழ (zh) distinct from ள and ல, soft stops between vowels (voiced intervocalically), pure short vowels, and clear ற/ன distinction; no aspirated consonants.",
  telugu: "Sing Telugu with every word ending in an open vowel, crisp retroflex ట డ ణ ళ, geminates (double consonants) held noticeably longer, and clear ఎ/ఏ ఒ/ఓ length contrast.",
  malayalam: "Sing Malayalam with distinct retroflex ള ഴ റ, held geminates, and the chillu final consonants clearly voiced.",
  hindi: "Sing Hindi with correct schwa deletion at word ends (e.g. 'kamal' not 'kamala'), crisp aspirated stops (ख घ छ झ ठ ढ थ ध फ भ), nasal vowels (ँ) kept nasal, and nukta sounds (ज़ फ़ क़) accurate.",
  marathi: "Sing Marathi with clear retroflex ळ, correct schwa retention rules, aspirated stops audible, and chandrabindu nasalisation.",
  bengali: "Sing Bengali with the characteristic o-vowel (অ as /ɔ/ or /o/), palato-alveolar শ ষ স as /ʃ/, and inherent vowel handling that is not Hindi-style.",
  sanskrit: "Sing Sanskrit with exact vowel lengths (short/long), visarga as a light h-echo, anusvara as a nasal, and clean conjunct clusters; follow classical (not colloquial Hindi) pronunciation.",
  punjabi: "Sing Punjabi with its tonal contrast (high/low tone on the aspirate series), retained final vowels in folk idiom, and retroflex ਟ ਡ ਣ ਲ਼ clearly articulated.",
  urdu: "Sing Urdu with its Perso-Arabic sounds kept distinct (ق خ غ ز ف), nasalised nun ghunna (ں) soft, long and short vowels held to length, and ghazal-style clear word endings; no Hindi-style schwa deletion shortcuts that change the word.",
  bhojpuri: "Sing Bhojpuri in its own dialect, not standard Hindi: keep forms such as 'रउरा', 'हमार', 'बा', and the open final vowels, with crisp retroflex ट ड ण and aspirated stops; do not substitute Hindi words.",
  odia: "Sing Odia with its retroflex ଟ ଡ ଣ ଳ distinct, the inherent vowel pronounced /ɔ/, aspirates audible, and nasal endings kept soft.",
  assamese: "Sing Assamese with ৰ and ৱ kept distinct, স শ ষ as the soft /x/ or /s/ of Assamese (not the Bengali /ʃ/), the open /ɔ/ vowel, and no Bengali-style palatal shift.",
  gujarati: "Sing Gujarati with open vowels, the ળ retroflex lateral, and nasalised endings kept soft.",
};

/** Pronunciation guidance appended to the Lyria style prompt. Empty string for unknown languages. */
export function dictionHints(language: string): string {
  const key = language.trim().toLowerCase();
  // Production passes the language code. Only the expansion languages are resolved from their code here; the five
  // launch languages keep today's prompt until the eval gate approves the same change for them (see strategy/language-expansion.md).
  return HINTS[key] ?? HINTS[expansionLanguage(key)?.name.toLowerCase() ?? ""] ?? "";
}

/**
 * Order-insensitive variant of scoreTranscript. A singer (Lyria) may sing sections in a different order than written,
 * which the in-order scorer reads as failure (a reordered Tamil song scored 51 where its content matched ~91).
 * Each intended line takes its best window anywhere in the transcript, but a stretch of transcript can only vouch for
 * one line (greedy by lowest CER, windows may overlap used text by at most 30%), so a single sung hook cannot score
 * a hook that appears twice in the lyric. Lines left without a window count as fully wrong.
 */
export function scoreTranscriptUnordered(intended: string, transcript: string, threshold = 0.35): DictionScore {
  const want = intended.split(/\n+/).map((l) => l.replace(/\[[^\]]*\]/g, "").trim()).filter((l) => norm(l).length > 0);
  const heard = Array.from(norm(transcript));
  const cands: { cer: number; li: number; s: number; e: number }[] = [];
  want.forEach((line, li) => {
    const len = Array.from(norm(line)).length;
    for (let s = 0; s < heard.length; s++) {
      for (const w of [Math.floor(len * 0.8), len, Math.ceil(len * 1.2)]) {
        const e = Math.min(heard.length, s + w);
        if (e <= s) continue;
        cands.push({ cer: charErrorRate(line, heard.slice(s, e).join("")), li, s, e });
      }
    }
  });
  cands.sort((a, b) => a.cer - b.cer);
  const used = new Array<boolean>(heard.length).fill(false);
  const pick = new Map<number, { cer: number; s: number; e: number }>();
  for (const c of cands) {
    if (pick.has(c.li)) continue;
    let overlap = 0;
    for (let i = c.s; i < c.e; i++) if (used[i]) overlap++;
    if (overlap > 0.3 * (c.e - c.s)) continue;
    pick.set(c.li, c);
    for (let i = c.s; i < c.e; i++) used[i] = true;
    if (pick.size === want.length) break;
  }
  const lines: LineScore[] = want.map((intendedLine, li) => {
    const p = pick.get(li);
    return p
      ? { intended: intendedLine, heard: heard.slice(p.s, p.e).join(""), cer: p.cer, flagged: p.cer > threshold }
      : { intended: intendedLine, heard: "", cer: 1, flagged: true };
  });
  const overall = lines.length ? lines.reduce((s, l) => s + l.cer, 0) / lines.length : 0;
  return { lines, overall, matchPct: Math.round((1 - overall) * 100) };
}

/** Both scores, for reporting: `ordered` is what production stores today; `unordered` ignores section order. */
export function scoreBoth(intended: string, transcript: string): { ordered: number; unordered: number } {
  return { ordered: scoreTranscript(intended, transcript).matchPct, unordered: scoreTranscriptUnordered(intended, transcript).matchPct };
}

const LAUNCH_CODE_NAME: Record<string, string> = { hi: "hindi", ta: "tamil", te: "telugu", kn: "kannada", bn: "bengali", sa: "sanskrit", mr: "marathi", pa: "punjabi", gu: "gujarati" };

/**
 * Production passes language CODES, so the five launch languages resolved to "" (the keys above are names). With
 * DICTION_HINTS_LAUNCH=1 the same hints reach Lyria for them too. Off by default until a with/without render probe
 * shows the Gemini diction score does not drop (see strategy/pce-cma-engine.md).
 */
export function dictionHintsFor(language: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const code = language.trim().toLowerCase();
  const hit = dictionHints(code);
  if (hit || env.DICTION_HINTS_LAUNCH !== "1") return hit;
  return dictionHints(LAUNCH_CODE_NAME[code] ?? "");
}
