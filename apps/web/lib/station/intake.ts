/**
 * First-run taste intake on /station (STATION_TASTE=1): three taps (languages, moods, energy) become a TasteBrief.
 * Signed-in listeners save it to their profile (`taste_profiles.stated`); everyone keeps a browser copy, which the player
 * also sends with the queue request as `taste=<json>` so signed-out listeners get the same ranking prior. The server
 * trusts nothing here: it re-parses the value through normaliseTaste and drops the free-text background.
 */
import { normaliseTaste, TASTE_ENERGY, TASTE_MOODS, type TasteBrief } from "@/lib/taste/brief";

export const INTAKE_KEY = "neo-fm:station-intake:v1";
/** The query value is untrusted input: refuse anything bigger than a full brief could be. */
export const INTAKE_PARAM_MAX = 600;
export const INTAKE_LANGS = ["en", "hi", "ta", "te", "kn", "bn", "mr"] as const;
/** The moods offered in the intake; the rest of the taste vocabulary stays in the song form. */
export const INTAKE_MOODS = TASTE_MOODS.filter((m) => ["joyful", "calm", "romantic", "devotional", "energetic", "nostalgic"].includes(m));
export const INTAKE_ENERGY = TASTE_ENERGY;
const MAX_PICKS = 3;

export interface IntakeSelection {
  languages: string[];
  moods: string[];
  energy: string | null;
}

export const EMPTY_INTAKE: IntakeSelection = { languages: [], moods: [], energy: null };

/** Toggle a pick, keeping the newest MAX_PICKS. */
export function togglePick(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value].slice(-MAX_PICKS);
}

/** The selection as a normalised brief; null when nothing was chosen or a value is outside the vocabulary. */
export function intakeBrief(sel: IntakeSelection): TasteBrief | null {
  return normaliseTaste({
    v: 1,
    languages: sel.languages.length ? sel.languages : undefined,
    moods: sel.moods.length ? sel.moods : undefined,
    energy: sel.energy ?? undefined,
  });
}

/** Reads the `taste` query value: bounded, JSON, closed vocabularies only, no free text. */
export function parseTasteParam(raw: string | null | undefined): TasteBrief | null {
  if (!raw || raw.length > INTAKE_PARAM_MAX) return null;
  try {
    const brief = normaliseTaste(JSON.parse(raw));
    if (!brief) return null;
    const { background: _background, ...rest } = brief;
    return normaliseTaste(rest);
  } catch {
    return null;
  }
}

export function selectionFromBrief(brief: TasteBrief | null): IntakeSelection {
  return {
    languages: [...(brief?.languages ?? [])],
    moods: [...(brief?.moods ?? [])],
    energy: brief?.energy ?? null,
  };
}

export function loadIntake(): TasteBrief | null {
  try {
    return parseTasteParam(localStorage.getItem(INTAKE_KEY));
  } catch {
    return null;
  }
}

export function saveIntake(brief: TasteBrief | null): void {
  try {
    if (brief) localStorage.setItem(INTAKE_KEY, JSON.stringify(brief));
    else localStorage.removeItem(INTAKE_KEY);
  } catch { /* private mode: the choice just is not remembered */ }
}
