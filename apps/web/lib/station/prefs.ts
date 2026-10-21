import { EXPANSION_LANGUAGES } from "../languages/registry";
import { cleanMix, type MixPick } from "./mix-picks";

/** The listener's station choice (language and up to two moods), remembered in this browser only. */
export const PREFS_KEY = "neo-fm:station-prefs:v1";
export const MAX_MOODS = 2;
/** Station pass holders may keep more (queue `moods=`, up to four). */
export const MAX_PASS_MOODS = 4;

/** Moods offered at onboarding; each is a tag the pool already carries (lib/pool/tags.ts POOL_MOODS). */
export const STATION_MOODS = ["joyful", "calm", "romantic", "devotional", "energetic", "nostalgic"] as const;
export const STATION_LANGS = ["hi", "ta", "te", "kn", "bn"] as const;
/** Expansion languages are accepted when parsing; the player drops a saved one whose chip is not offered (wave off or pool too small). */
const SAVED_LANGS: readonly string[] = [...STATION_LANGS, ...EXPANSION_LANGUAGES.map((l) => l.code), ""];

export interface StationPrefs {
  /** "" means all languages. */
  lang: string;
  moods: string[];
  /** Station pass language mix; empty when the listener has none. */
  mix?: MixPick[];
}

export function parsePrefs(raw: string | null, maxMoods = MAX_MOODS): StationPrefs | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { lang?: unknown; moods?: unknown; mix?: unknown };
    const lang = typeof v.lang === "string" && SAVED_LANGS.includes(v.lang) ? v.lang : "";
    const moods = Array.isArray(v.moods)
      ? v.moods.filter((m): m is string => (STATION_MOODS as readonly string[]).includes(m as string)).slice(0, maxMoods)
      : [];
    const mix = cleanMix(v.mix, SAVED_LANGS);
    return { lang, moods: [...new Set(moods)], ...(mix.length ? { mix } : {}) };
  } catch {
    return null;
  }
}

/** Toggle a mood, keeping at most `max`; picking one more drops the oldest pick. */
export function toggleMood(moods: string[], mood: string, max = MAX_MOODS): string[] {
  if (moods.includes(mood)) return moods.filter((m) => m !== mood);
  return [...moods, mood].slice(-max);
}

export function loadPrefs(maxMoods = MAX_MOODS): StationPrefs | null {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY), maxMoods);
  } catch {
    return null;
  }
}

export function savePrefs(p: StationPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch { /* private mode: the choice just is not remembered */ }
}
