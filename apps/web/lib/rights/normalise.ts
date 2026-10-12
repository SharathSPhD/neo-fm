/**
 * Text normalisation shared by the brief screen and the verbatim check. Must treat Latin and Indic scripts alike:
 * Latin is case/diacritic/punctuation-folded; Indic text keeps its vowel signs and viramas (stripping marks there
 * would destroy words) and only loses the nukta, which users type inconsistently (रफ़ी / रफी, आवाज़ / आवाज).
 */
export function normaliseText(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/([a-z])\p{M}+/gu, "$1") // é -> e, only after a Latin letter
    .replace(/़|়/g, "") // Devanagari / Bengali nukta
    .normalize("NFC")
    .replace(/[​-‏⁠﻿]/g, "") // zero-width chars used to dodge matching (ZWJ/ZWNJ included, folded on both sides)
    .replace(/[.\-_,;:!?'"“”‘’()[\]{}/\\|*•·।॥]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type Script = "latin" | "devanagari" | "tamil" | "telugu" | "kannada" | "bengali";
export type Lang = "en" | "hi" | "ta" | "te" | "kn" | "bn";

const RANGES: [Script, RegExp][] = [
  ["devanagari", /[ऀ-ॿ]/g], ["bengali", /[ঀ-৿]/g], ["tamil", /[஀-௿]/g],
  ["telugu", /[ఀ-౿]/g], ["kannada", /[ಀ-೿]/g],
];
const LANG_OF: Record<Script, Lang> = { latin: "en", devanagari: "hi", bengali: "bn", tamil: "ta", telugu: "te", kannada: "kn" };

/** Language to answer in: the dominant non-Latin script of the text, else the caller's hint, else English. */
export function detectLang(raw: string, hint?: string): Lang {
  let best: Script = "latin"; let bestN = 0;
  for (const [s, re] of RANGES) { const n = raw.match(re)?.length ?? 0; if (n > bestN) { best = s; bestN = n; } }
  if (bestN > 0) return LANG_OF[best];
  const h = (hint ?? "").slice(0, 2).toLowerCase();
  return (["hi", "ta", "te", "kn", "bn"] as const).find((l) => l === h) ?? "en";
}

export const isLatin = (s: string) => !/[^\u0000-ɏ ]/.test(s);

/** Contains `needle` (already normalised): whole-word for Latin, plain substring for Indic (suffixes attach to names). */
export function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return isLatin(needle) ? ` ${haystack} `.includes(` ${needle} `) : haystack.includes(needle);
}
