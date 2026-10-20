import Sanscript from "@indic-transliteration/sanscript";

import { detectScript, type Script } from "./index";

const SCHEME: Partial<Record<Script, string>> = {
  devanagari: "devanagari", bengali: "bengali", gurmukhi: "gurmukhi", gujarati: "gujarati", odia: "oriya",
  tamil: "tamil", telugu: "telugu", kannada: "kannada", malayalam: "malayalam",
};

/**
 * Marks the transliteration tables leave untouched, rewritten to forms they do handle. Each rule applies to a script
 * the launch languages do not use (or to characters only Assamese uses), so existing output is unchanged.
 */
const GURMUKHI_CONS = "[\\u0a15-\\u0a39\\u0a59-\\u0a5e]";
const CHILLU: Record<string, string> = { "\u0d7a": "\u0d23\u0d4d", "\u0d7b": "\u0d28\u0d4d", "\u0d7c": "\u0d30\u0d4d", "\u0d7d": "\u0d32\u0d4d", "\u0d7e": "\u0d33\u0d4d", "\u0d7f": "\u0d15\u0d4d" };
function prepare(line: string, scheme: string): string {
  switch (scheme) {
    // Addak doubles the consonant after it: X + addak + Y is read as X + Y-halant + Y.
    case "gurmukhi": return line.replace(new RegExp(`\u0a71(${GURMUKHI_CONS})`, "g"), "$1\u0a4d$1");
    // Atomic chillu letters are plain consonant + virama to the table.
    case "malayalam": return line.replace(/[\u0d7a-\u0d7f]/g, (c) => CHILLU[c] ?? c);
    // Assamese ra (U+09F0) and wa (U+09F1) are not in the Bengali table; ra reads as র, wa as ব.
    case "bengali": return line.replace(/\u09f0/g, "\u09b0").replace(/\u09f1/g, "\u09ac");
    default: return line;
  }
}
const roman = (line: string, scheme: string) => Sanscript.t(prepare(line, scheme), scheme, "itrans").replace(/[èé]/g, "e").replace(/[òó]/g, "o");
const tagOf = (l: string): string | null => {
  const m = l.match(/^(?:#+\s*|\*{0,2}\[?)([^\]*#]+?)\]?\*{0,2}$/);
  return /^#|^\*{0,2}\[/.test(l) && m ? m[1]!.trim() : null;
};

/** Romanization of one lyric line (ITRANS-based); Latin-script lines are returned unchanged. */
export function romanizeLine(line: string): string {
  const scheme = SCHEME[detectScript(line)];
  return scheme ? roman(line, scheme) : line;
}

/**
 * "Singing script" for the music model: every lyric line is followed by its romanization in parentheses (measured on 6
 * Kannada/Tamil/Telugu/Hindi clips with Gemini transcription: character error rate 4.6% native-only -> 1.1% with
 * romanization, and no filler syllables / dialect drift). Section tags are kept as [Tag]; Latin-script lines are unchanged.
 */
export function singingScript(lyrics: string): { text: string; romanized: boolean } {
  const out: string[] = [];
  let romanized = false;
  for (const raw of lyrics.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) { out.push(""); continue; }
    const tag = tagOf(l);
    if (tag) { out.push(`[${tag}]`); continue; }
    const scheme = SCHEME[detectScript(l)];
    if (!scheme) { out.push(l); continue; }
    out.push(l, `(${roman(l, scheme)})`);
    romanized = true;
  }
  return { text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), romanized };
}

export const ROMAN_HINT = "Each lyric line is followed by its romanization in parentheses purely to guide pronunciation: sing the native-script line once, never sing or speak the parentheses.";
