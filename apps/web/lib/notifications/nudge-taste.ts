/**
 * Taste-aware copy and deep link for the daily station nudge (flag NUDGE_TASTE=1, on top of STATION_NUDGE_ENABLED).
 * Pure: the job loads the saved taste profile and passes it in. Without usable moods the caller keeps the plain nudge.
 * Daypart words are machine-written and not yet read by a native speaker, like the rest of the nudge copy.
 */
import type { TasteBrief } from "../taste/brief";
import { tasteLabel } from "../taste/labels";
import { daypartOf } from "../station/taste-bias";
import { MAX_MOODS, STATION_LANGS, STATION_MOODS } from "../station/prefs";
import { NUDGE_COPY, nudgeLang, type NudgeLang } from "./nudge-copy";

export const nudgeTasteEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.NUDGE_TASTE === "1";

type Part = "morning" | "afternoon" | "evening" | "night";

const DAY_WORD: Record<NudgeLang, Record<Part, string>> = {
  en: { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" },
  hi: { morning: "सुबह", afternoon: "दोपहर", evening: "शाम", night: "रात" },
  kn: { morning: "ಬೆಳಿಗ್ಗೆ", afternoon: "ಮಧ್ಯಾಹ್ನ", evening: "ಸಂಜೆ", night: "ರಾತ್ರಿ" },
  te: { morning: "ఉదయం", afternoon: "మధ్యాహ్నం", evening: "సాయంత్రం", night: "రాత్రి" },
  ta: { morning: "காலை", afternoon: "மதியம்", evening: "மாலை", night: "இரவு" },
  mr: { morning: "सकाळ", afternoon: "दुपार", evening: "संध्याकाळ", night: "रात्र" },
};

/** The nudge goes out in the listener's morning; with no time zone stored server-side we use India Standard Time. */
const IST_OFFSET_MS = 5.5 * 3600_000;
export const nudgeHour = (now: number): number => new Date(now + IST_OFFSET_MS).getUTCHours();

export interface TasteNudge {
  title: string;
  body: string;
  href: string;
}

const MOOD_SET = new Set<string>(STATION_MOODS);

/** Moods for this daypart: the one they asked for at this time of day first, then their general picks. Station moods only, at most two. */
export function nudgeMoods(taste: TasteBrief, part: Part): string[] {
  const asked = part === "morning" || part === "afternoon" || part === "evening" || part === "night" ? taste.daypart_moods?.[part] : undefined;
  return [...new Set([...(asked ? [asked] : []), ...(taste.moods ?? [])])].filter((m) => MOOD_SET.has(m)).slice(0, MAX_MOODS);
}

/** Station chip language from the saved taste: the first language they listen in that the station offers. */
export function nudgeStationLang(taste: TasteBrief, offered: readonly string[] = STATION_LANGS): string {
  return (taste.languages ?? []).find((l) => offered.includes(l)) ?? "";
}

export function tasteNudge(taste: TasteBrief | null, fallbackLang: string | undefined, now: number): TasteNudge | null {
  if (!taste) return null;
  const part = daypartOf(nudgeHour(now));
  const moods = nudgeMoods(taste, part);
  const stationLang = nudgeStationLang(taste);
  if (!moods.length && !stationLang) return null;
  const lang = nudgeLang(taste.languages?.find((l) => l in NUDGE_COPY) ?? fallbackLang);
  const q = new URLSearchParams();
  if (stationLang) q.set("lang", stationLang);
  if (moods.length) q.set("moods", moods.join(","));
  const mood = moods.map((m) => tasteLabel(m, lang)).join(", ");
  return {
    title: NUDGE_COPY[lang].title,
    body: mood ? `${DAY_WORD[lang][part]}: ${mood}` : NUDGE_COPY[lang].body,
    href: `/station?${q}`,
  };
}
