/**
 * Almanac: short spoken festival countdowns for the station's feature slot ("Diwali is two days away"). The facts are
 * computed from the date and a fixed festival table, and the text is templated, so no model writes a fact and nothing is
 * scraped (strategy/station-programming.md). Lines are keyed by festival, days away and language, not by calendar date, so
 * one rendered set serves every year the table covers. A line only plays when its audio exists (voice-almanac.json) and
 * STATION_ALMANAC=1, so with the flag on and no render nothing changes.
 */
import rendered from "./voice-almanac.json";
import type { VoiceLine } from "./voice-links";

export const ALMANAC_LANGS = ["hi", "ta", "te", "kn", "bn", "en"] as const;
export type AlmanacLang = (typeof ALMANAC_LANGS)[number];

/** Days ahead we announce: the day itself, the day before, and two more. Keeps the render set small (TTS is capped per day). */
export const ALMANAC_DAYS = [0, 1, 2, 3] as const;

interface Festival {
  id: string;
  /** Calendar dates (YYYY-MM-DD) from the published calendars; extend before the last one passes. Regional calendars differ, so only dates observed nationwide belong here. */
  dates: string[];
  name: Record<AlmanacLang, string>;
}

export const FESTIVALS: readonly Festival[] = [
  { id: "dhanteras", dates: ["2026-11-06"], name: { hi: "धनतेरस", ta: "தனதேரஸ்", te: "ధన త్రయోదశి", kn: "ಧನತ್ರಯೋದಶಿ", bn: "ধনতেরাস", en: "Dhanteras" } },
  { id: "diwali", dates: ["2026-11-08"], name: { hi: "दीपावली", ta: "தீபாவளி", te: "దీపావళి", kn: "ದೀಪಾವಳಿ", bn: "দীপাবলি", en: "Diwali" } },
  { id: "bhai-dooj", dates: ["2026-11-11"], name: { hi: "भाई दूज", ta: "பாய் தூஜ்", te: "భాయ్ దూజ్", kn: "ಭಾಯಿ ದೂಜ್", bn: "ভাই ফোঁটা", en: "Bhai Dooj" } },
  { id: "christmas", dates: ["2026-12-25"], name: { hi: "क्रिसमस", ta: "கிறிஸ்துமஸ்", te: "క్రిస్మస్", kn: "ಕ್ರಿಸ್ಮಸ್", bn: "বড়দিন", en: "Christmas" } },
  { id: "new-year", dates: ["2027-01-01"], name: { hi: "नया साल", ta: "புத்தாண்டு", te: "కొత్త సంవత్సరం", kn: "ಹೊಸ ವರ್ಷ", bn: "নতুন বছর", en: "New Year" } },
  { id: "pongal", dates: ["2027-01-14"], name: { hi: "पोंगल और संक्रांति", ta: "பொங்கல்", te: "సంక్రాంతి", kn: "ಸಂಕ್ರಾಂತಿ", bn: "পৌষ সংক্রান্তি", en: "Pongal and Sankranti" } },
  { id: "republic-day", dates: ["2027-01-26"], name: { hi: "गणतंत्र दिवस", ta: "குடியரசு தினம்", te: "గణతంత్ర దినోత్సవం", kn: "ಗಣರಾಜ್ಯೋತ್ಸವ", bn: "প্রজাতন্ত্র দিবস", en: "Republic Day" } },
];

/** Number words for 2 and 3, the only counts above one day we announce. */
const COUNT: Record<AlmanacLang, [string, string]> = {
  hi: ["दो", "तीन"], ta: ["இரண்டு", "மூன்று"], te: ["రెండు", "మూడు"], kn: ["ಎರಡು", "ಮೂರು"], bn: ["দুই", "তিন"], en: ["two", "three"],
};

type Say = (f: string, n: string) => string;
const TEMPLATE: Record<AlmanacLang, { today: Say; tomorrow: Say; soon: Say }> = {
  hi: {
    today: (f) => `आज ${f} है। neo-fm की तरफ़ से आपको ढेर सारी शुभकामनाएँ।`,
    tomorrow: (f) => `कल ${f} है। त्योहार की धुनें neo-fm पर चलती रहेंगी।`,
    soon: (f, n) => `${f} में बस ${n} दिन बाकी हैं। त्योहार की धुनें neo-fm पर चलती रहेंगी।`,
  },
  ta: {
    today: (f) => `இன்று ${f}. neo-fm சார்பில் இனிய வாழ்த்துகள்.`,
    tomorrow: (f) => `நாளை ${f}. பண்டிகை இசை neo-fm-இல் தொடரும்.`,
    soon: (f, n) => `${f} வர இன்னும் ${n} நாட்கள் உள்ளன. பண்டிகை இசை neo-fm-இல் தொடரும்.`,
  },
  te: {
    today: (f) => `ఈ రోజు ${f}. neo-fm తరఫున శుభాకాంక్షలు.`,
    tomorrow: (f) => `రేపే ${f}. పండుగ సంగీతం neo-fm లో కొనసాగుతుంది.`,
    soon: (f, n) => `${f} రావడానికి ఇంకా ${n} రోజులు మాత్రమే. పండుగ సంగీతం neo-fm లో కొనసాగుతుంది.`,
  },
  kn: {
    today: (f) => `ಇಂದು ${f}. neo-fm ಕಡೆಯಿಂದ ಶುಭಾಶಯಗಳು.`,
    tomorrow: (f) => `ನಾಳೆ ${f}. ಹಬ್ಬದ ಸಂಗೀತ neo-fm ನಲ್ಲಿ ಮುಂದುವರಿಯುತ್ತದೆ.`,
    soon: (f, n) => `${f} ಬರಲು ಇನ್ನು ${n} ದಿನಗಳು ಮಾತ್ರ. ಹಬ್ಬದ ಸಂಗೀತ neo-fm ನಲ್ಲಿ ಮುಂದುವರಿಯುತ್ತದೆ.`,
  },
  bn: {
    today: (f) => `আজ ${f}। neo-fm-এর পক্ষ থেকে শুভেচ্ছা।`,
    tomorrow: (f) => `কাল ${f}। উৎসবের গান neo-fm-এ চলতে থাকবে।`,
    soon: (f, n) => `${f}-এর আর মাত্র ${n} দিন বাকি। উৎসবের গান neo-fm-এ চলতে থাকবে।`,
  },
  en: {
    today: (f) => `Today is ${f}. Warm wishes from all of us at neo-fm.`,
    tomorrow: (f) => `Tomorrow is ${f}. The festive music keeps playing on neo-fm.`,
    soon: (f, n) => `Just ${n} days to ${f}. The festive music keeps playing on neo-fm.`,
  },
};

export function almanacId(festival: string, days: number, lang: string): string {
  return `almanac/${festival}-d${days}-${lang}`;
}

export function almanacText(festival: Festival, days: number, lang: AlmanacLang): string {
  const t = TEMPLATE[lang];
  const name = festival.name[lang];
  return days === 0 ? t.today(name, "") : days === 1 ? t.tomorrow(name, "") : t.soon(name, COUNT[lang][days - 2]!);
}

/** Every line the table can produce, rendered or not: the render script's worklist and the set of ids a client may report as seen. */
export function allAlmanacLines(): Array<VoiceLine & { festival: string; days: number }> {
  return FESTIVALS.flatMap((f) =>
    ALMANAC_DAYS.flatMap((days) =>
      ALMANAC_LANGS.map((lang) => ({
        id: almanacId(f.id, days, lang), kind: "almanac" as const, lang, seconds: 0, text: almanacText(f, days, lang), festival: f.id, days,
      })),
    ),
  );
}

const SECONDS = rendered as Record<string, number>;

export function almanacEnabled(): boolean {
  return process.env.STATION_ALMANAC === "1";
}

const DAY_MS = 86_400_000;
const utcDay = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

/** The festival countdowns that apply on a listener-local date, as `{ festival, days }`. Year is passed in so this stays pure. */
export function countdownsOn(year: number, month: number, day: number): Array<{ festival: string; days: number }> {
  const today = utcDay(year, month, day);
  const out: Array<{ festival: string; days: number }> = [];
  for (const f of FESTIVALS) {
    for (const date of f.dates) {
      const [y, m, d] = date.split("-").map(Number) as [number, number, number];
      const days = Math.round((utcDay(y, m, d) - today) / DAY_MS);
      if ((ALMANAC_DAYS as readonly number[]).includes(days)) out.push({ festival: f.id, days });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

/** Ids of the rendered almanac lines for today, nearest festival first. Empty when the flag is off or nothing has been rendered. */
export function almanacIdsFor(year: number, month: number, day: number, enabled: boolean = almanacEnabled()): string[] {
  if (!enabled) return [];
  return countdownsOn(year, month, day).flatMap(({ festival, days }) =>
    ALMANAC_LANGS.map((lang) => almanacId(festival, days, lang)).filter((id) => (SECONDS[id] ?? 0) > 0),
  );
}

/** Rendered lines the queue may use (flag on): the ones whose audio has been made and added to voice-almanac.json. */
export function almanacLines(enabled: boolean = almanacEnabled()): VoiceLine[] {
  return enabled ? allAlmanacLines().filter((l) => (SECONDS[l.id] ?? 0) > 0).map((l) => ({ ...l, seconds: SECONDS[l.id]! })) : [];
}

/** Every rendered line regardless of the flag, so the CDN mirror can fill `voice/almanac/<id>.mp3` before it is switched on. */
export function renderedAlmanac(): VoiceLine[] {
  return almanacLines(true);
}
