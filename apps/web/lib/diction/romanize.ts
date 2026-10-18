import Sanscript from "@indic-transliteration/sanscript";

import { detectScript, type Script } from "./index";

const SCHEME: Partial<Record<Script, string>> = {
  devanagari: "devanagari", bengali: "bengali", gurmukhi: "gurmukhi", gujarati: "gujarati", odia: "oriya",
  tamil: "tamil", telugu: "telugu", kannada: "kannada", malayalam: "malayalam",
};

const roman = (line: string, scheme: string) => Sanscript.t(line, scheme, "itrans").replace(/[èé]/g, "e");
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
