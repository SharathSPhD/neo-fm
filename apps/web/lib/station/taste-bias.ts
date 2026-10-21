/**
 * Station taste prior: the listener's saved taste profile (`taste_profiles.stated`, lib/taste) as a small, bounded nudge on
 * the ranking score. It is a cold-start prior only: the listener's own plays, likes and skips (rank.ts) are worth more than
 * the whole bonus, so behaviour overwrites it. Off unless STATION_TASTE=1. Pure functions; the queue route passes the profile in.
 */
import type { PoolTrack } from "./rank";
import type { TasteBrief } from "@/lib/taste/brief";
import { tasteLabel } from "@/lib/taste/labels";

export function stationTasteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STATION_TASTE === "1";
}

export type Daypart = "morning" | "afternoon" | "evening" | "night";

export function daypartOf(hour: number): Daypart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

const TAG_BONUS = 0.6;
const TAG_CAP = 1.5;
const DAYPART_MOOD_BONUS = 0.8;
const ENERGY_BONUS = 0.5;
const LANGUAGE_BONUS = 1;
/** Everything together stays under a single like (3), so a couple of real signals outweigh the prior. */
const TOTAL_CAP = 2.5;

const ENERGY_BAND = { calm: "low", medium: "mid", high: "high" } as const;

export interface TasteBiasOptions {
  /** Listener-local hour, for the mood they want at this time of day. */
  hour: number;
  /** True when the listener asked for a language: that choice wins, so the language mix is not applied. */
  languageLocked?: boolean;
}

/** Score added to a track for this taste profile; 0 when the profile says nothing that matches. */
export function tasteBias(taste: TasteBrief, opts: TasteBiasOptions): (t: PoolTrack) => number {
  const wanted = new Set([...(taste.genres ?? []), ...(taste.moods ?? [])].map((x) => x.toLowerCase()));
  const dayMood = taste.daypart_moods?.[daypartOf(opts.hour)]?.toLowerCase();
  const langs = new Set<string>(opts.languageLocked ? [] : taste.languages ?? []);
  const band = taste.energy ? ENERGY_BAND[taste.energy] : null;
  return (t) => {
    let tags = 0;
    for (const tag of t.tags) if (wanted.has(tag)) tags += TAG_BONUS;
    let score = Math.min(tags, TAG_CAP);
    if (dayMood && t.tags.includes(dayMood)) score += DAYPART_MOOD_BONUS;
    if (band && t.energy === band) score += ENERGY_BONUS;
    // Instrumentals are language-neutral, so the language mix never favours or penalises them.
    if (langs.size && t.kind !== "instrumental" && langs.has(t.language)) score += LANGUAGE_BONUS;
    return Math.min(score, TOTAL_CAP);
  };
}

/** "For your calm mood." per language; machine-translated like the rest of the host copy, pending native review. Languages without a template get no note. */
const MOOD_NOTE: Readonly<Record<string, (mood: string) => string>> = {
  en: (m) => `For your ${m} mood.`,
  hi: (m) => `आपके ${m} मूड के लिए।`,
  mr: (m) => `तुमच्या ${m} मूडसाठी.`,
  ta: (m) => `உங்கள் ${m} மனநிலைக்காக.`,
  te: (m) => `మీ ${m} మూడ్ కోసం.`,
  kn: (m) => `ನಿಮ್ಮ ${m} ಮನಸ್ಥಿತಿಗಾಗಿ.`,
  bn: (m) => `আপনার ${m} মেজাজের জন্য।`,
};

/**
 * Extra sentence for a track's host line when the track carries a mood the listener saved (the daypart mood first), so the
 * line only ever says something true about the track. Null when nothing matches or the language has no template.
 * Spoken links are pre-rendered audio and cannot be personalised, so this covers the text host line only.
 */
export function tasteHostNote(taste: TasteBrief, track: Pick<PoolTrack, "tags">, language: string, hour: number): string | null {
  const template = MOOD_NOTE[language];
  if (!template) return null;
  const dayMood = taste.daypart_moods?.[daypartOf(hour)];
  const candidates: string[] = dayMood ? [dayMood, ...(taste.moods ?? [])] : [...(taste.moods ?? [])];
  const mood = candidates.find((m) => track.tags.includes(m.toLowerCase()));
  return mood ? template(tasteLabel(mood, language)) : null;
}
