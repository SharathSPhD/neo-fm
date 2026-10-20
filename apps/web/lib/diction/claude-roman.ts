import { romanizeLine } from "./romanize";

/**
 * Claude-written romanization for the music model. Lyria sang native lines plus a mechanical ITRANS guide at ~65 sung-word
 * match for Tamil and Telugu; Latin-only lines written the way the language is spoken scored ~97 in the pilot
 * (docs/handoff/song-render-harness.md, E5). Off unless DICTION_CLAUDE_ROMAN lists the language; any failure returns null
 * so the caller keeps the existing singing script.
 */
export const CLAUDE_ROMAN_MODEL = "claude-sonnet-5-5";

/** DICTION_CLAUDE_ROMAN="ta,te" (language codes). Unset or empty means off for every language. */
export function claudeRomanLanguages(env: Readonly<Record<string, string | undefined>> = process.env): Set<string> {
  return new Set((env.DICTION_CLAUDE_ROMAN ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

const isTag = (l: string) => /^#|^\*{0,2}\[/.test(l);
/** Lines in an Indic script that the mechanical romanizer knows; tags, blanks and Latin lines are left alone. */
const isNative = (l: string) => !isTag(l) && l.trim() !== "" && romanizeLine(l.trim()) !== l.trim();

export function buildRomanPrompt(language: string, lines: readonly string[]): string {
  return `Write each ${language} song lyric line below in plain Latin letters so a singer who reads English can pronounce it exactly as the line is spoken and sung.
- Spell phonetically the way the language sounds (for example Tamil "zh" for ழ, doubled letters for long vowels, no capital letters, no diacritics, no ITRANS symbols).
- Keep every word, in order. Do not translate, correct, add or drop anything.
- Return ONLY a JSON array of exactly ${lines.length} strings, one per input line, in order. No commentary, no code fence.

Lines:
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
}

/** Accepts a bare JSON array or one in a code fence; null unless it is exactly n non-empty Latin-only strings. */
export function parseRoman(text: string, n: number): string[] | null {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const v: unknown = JSON.parse(body);
    if (!Array.isArray(v) || v.length !== n) return null;
    const out = (v as unknown[]).map((x) => (typeof x === "string" ? x.trim() : ""));
    return out.every((x) => x !== "" && /^[\p{Script=Latin}\s,.'!?;:-]+$/u.test(x)) ? out : null;
  } catch {
    return null;
  }
}

/** Lyrics with every native line replaced by its Claude romanization (tags and blank lines kept); null when nothing to do or on any failure. */
export async function claudeRomanize(
  lyrics: string, language: string, complete: (prompt: string) => Promise<string>,
): Promise<string | null> {
  const rows = lyrics.split(/\r?\n/);
  const idx = rows.flatMap((r, i) => (isNative(r) ? [i] : []));
  if (idx.length === 0) return null;
  try {
    const roman = parseRoman(await complete(buildRomanPrompt(language, idx.map((i) => rows[i]!.trim()))), idx.length);
    if (!roman) return null;
    const out = [...rows];
    idx.forEach((i, k) => { out[i] = roman[k]!; });
    return out.join("\n");
  } catch {
    return null;
  }
}

/** First n lyric lines of a romanized song, for the job trace (tags and blanks skipped). */
export function romanSample(text: string, n = 2): string {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "" && !isTag(l)).slice(0, n).join(" / ");
}
