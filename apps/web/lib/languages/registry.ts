/**
 * Song and station languages beyond the five launch languages (strategy/language-expansion.md).
 *
 * Nothing here is live until `LANG_WAVES` enables the wave, which an operator sets only after the language-enum
 * migration (launch/drafts/language_expansion.sql) is applied and the language's probe passed. The default, an empty
 * or unset `LANG_WAVES`, keeps today's behaviour exactly. Pure functions: the caller passes the env value so server
 * components, routes and tests all go through the same rule.
 */
import type { Language } from "@neo-fm/song-doc";

export type Wave = 1 | 2 | 3;

export interface ExpansionLanguage {
  code: Language;
  name: string;
  /** The language written in its own script. */
  endonym: string;
  script: "devanagari" | "gurmukhi" | "gujarati" | "malayalam" | "odia" | "arabic" | "bengali";
  wave: Wave;
}

export const EXPANSION_LANGUAGES: readonly ExpansionLanguage[] = [
  { code: "mr", name: "Marathi", endonym: "मराठी", script: "devanagari", wave: 1 },
  { code: "pa", name: "Punjabi", endonym: "ਪੰਜਾਬੀ", script: "gurmukhi", wave: 1 },
  { code: "gu", name: "Gujarati", endonym: "ગુજરાતી", script: "gujarati", wave: 1 },
  { code: "ml", name: "Malayalam", endonym: "മലയാളം", script: "malayalam", wave: 1 },
  { code: "bho", name: "Bhojpuri", endonym: "भोजपुरी", script: "devanagari", wave: 2 },
  { code: "or", name: "Odia", endonym: "ଓଡ଼ିଆ", script: "odia", wave: 2 },
  { code: "ur", name: "Urdu", endonym: "اردو", script: "arabic", wave: 2 },
  { code: "as", name: "Assamese", endonym: "অসমীয়া", script: "bengali", wave: 3 },
];

/** Admitted tracks a language needs in the pool before its station chip is offered (council rule). */
export const DEFAULT_MIN_POOL = 25;

/** Highest enabled wave from the env value; anything that is not 1, 2 or 3 means none. */
export function enabledWave(raw: string | undefined | null): 0 | Wave {
  const n = Number((raw ?? "").trim());
  return n === 1 || n === 2 || n === 3 ? n : 0;
}

export function enabledExpansionLanguages(raw: string | undefined | null): readonly ExpansionLanguage[] {
  const max = enabledWave(raw);
  return EXPANSION_LANGUAGES.filter((l) => l.wave <= max);
}

/** True for the five launch languages (plus en/sa), and for expansion languages whose wave is enabled. */
export function isEnabledLanguage(code: string, raw: string | undefined | null): boolean {
  const ex = EXPANSION_LANGUAGES.find((l) => l.code === code);
  return ex ? ex.wave <= enabledWave(raw) : true;
}

export function expansionLanguage(code: string | null | undefined): ExpansionLanguage | undefined {
  return EXPANSION_LANGUAGES.find((l) => l.code === code);
}

/**
 * Expansion languages that get a station chip: wave enabled and at least `min` admitted tracks, so a listener never
 * locks onto a language with nothing to play. Order follows the registry (wave, then listing order).
 */
export function stationChipLanguages(
  wavesRaw: string | undefined | null,
  minRaw: string | undefined | null,
  admittedByLanguage: Readonly<Record<string, number>>,
): ExpansionLanguage[] {
  const min = minPool(minRaw);
  return enabledExpansionLanguages(wavesRaw).filter((l) => (admittedByLanguage[l.code] ?? 0) >= min);
}

/** `LANG_MIN_POOL` override, falling back to the council's 25; invalid values fall back too. */
export function minPool(raw: string | undefined | null): number {
  const t = (raw ?? "").trim();
  const n = Number(t);
  return t !== "" && Number.isInteger(n) && n >= 0 ? n : DEFAULT_MIN_POOL;
}
