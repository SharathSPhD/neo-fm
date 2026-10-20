/**
 * Indian music style catalog for the PCE/CMA engine (docs/pce-cma-engine.md).
 *
 * Data comes from the styles research (strategy/indian-music-styles.json, 82 styles), trimmed by
 * `scripts/gen-engine-styles.mjs` into ./styles.json. The Postgres `style_family_enum` has ten values, so a song's DB
 * family stays coarse; the finer style id travels in `song_documents.document_json.metadata.genre` (jsonb, no
 * migration) and decides the lyric form for the poets, the notes for the polisher and the English style fragment for
 * Lyria. Native-script Lyria hints are not shipped (machine-written, awaiting a native read). Nothing here names a real
 * artist to imitate.
 */
import raw from "./styles.json";

export type VocalFit = "good" | "ok" | "risky" | "untested" | "na" | "no";

export interface Genre {
  id: string;
  name: string;
  tradition: string;
  languages: readonly string[];
  /** Section tags for the lyric, in order. */
  forms: readonly string[];
  /** What makes a lyric belong to this style: form, metre, things to avoid, sensitivity. */
  lyricNotes: string;
  /** English fragment appended to the Lyria style prompt. */
  lyria: string;
  vocal: VocalFit;
  priority: string;
  dayparts: readonly string[];
  moods: readonly string[];
}

interface RawStyle {
  id: string; name: string; tradition: string; languages: string[]; lyric_form: string; metre: string; instruments: string[];
  lyria_hint_en: string; lyria_vocal: VocalFit; pce_sections: string[]; must_avoid: string[]; sensitivity: string | null;
  launch_priority: string; dayparts: string[]; moods: string[];
}
interface RawData {
  styles: RawStyle[];
  festivals: { festival: string; styles: string[]; themes: string[] }[];
  routing: { keyword_map: Record<string, string>; by_language: Record<string, string[]>; daypart_defaults: Record<string, string[]> };
}
const data = raw as unknown as RawData;

/** PCE writes sung lyrics: drop styles the research marks `no` (scripture or community-sensitive, excluded) and `na` (instrumental-pool styles with no lyric form). */
const usable = (s: RawStyle) => s.lyria_vocal !== "no" && s.lyria_vocal !== "na" && s.launch_priority !== "excluded";

export const GENRES: readonly Genre[] = data.styles.filter(usable).map((s) => ({
  id: s.id, name: s.name, tradition: s.tradition, languages: s.languages, forms: s.pce_sections,
  lyricNotes: [
    s.lyric_form ? `Form: ${s.lyric_form}.` : "", s.metre ? `Metre: ${s.metre}.` : "",
    s.must_avoid?.length ? `Avoid: ${s.must_avoid.join("; ")}.` : "", s.sensitivity ? `Sensitivity: ${s.sensitivity}.` : "",
  ].filter(Boolean).join(" "),
  lyria: s.lyria_hint_en, vocal: s.lyria_vocal, priority: s.launch_priority, dayparts: s.dayparts ?? [], moods: s.moods ?? [],
}));

const BY_ID = new Map(GENRES.map((g) => [g.id, g]));
export const genreById = (id: string | null | undefined): Genre | undefined => (id ? BY_ID.get(id) : undefined);

/** Raga, folk, devotional and light-classical styles: Lyria sings over "instrumental" renders 75-100% of the time (lab R5), so they are always vocal songs. */
const VOCAL_ONLY = new Set(["hindustani", "carnatic", "folk", "devotional", "light"]);
export const isVocalOnly = (g: Genre): boolean => VOCAL_ONLY.has(g.tradition);

/** `[keyword, styleId]` longest keyword first, so "dasara pada" beats "dasa". Keywords whose style is excluded are dropped. */
export const KEYWORDS: readonly (readonly [string, string])[] = Object.entries(data.routing.keyword_map)
  // Bare "sangeet" also appears in sugam sangeet, natyasangeet and rabindrasangeet, so it never routes on its own.
  .filter(([k, id]) => BY_ID.has(id) && k.toLowerCase() !== "sangeet").sort((a, b) => b[0].length - a[0].length);

export const FESTIVALS = data.festivals.map((f) => ({ name: f.festival.toLowerCase(), styles: f.styles.filter((id) => BY_ID.has(id)), themes: f.themes }));
export const DAYPART_DEFAULTS: Record<string, readonly string[]> = data.routing.daypart_defaults;
export const LANGUAGE_DEFAULTS: Record<string, readonly string[]> = data.routing.by_language;

/** A style fits a language when listed for it, or when it is pan-language (more than three languages, e.g. lullabies). */
export const fitsLanguage = (g: Genre, language: string): boolean => g.languages.includes(language) || g.languages.length > 3;

/** Latin keywords match whole words only ("hori" must not fire on "authority", "raga" not on "ragamuffin"); other scripts have no spaces, so they stay substring matches. */
export function mentions(text: string, key: string): boolean {
  const t = text.toLowerCase(), k = key.toLowerCase();
  if (!/^[a-z0-9 ]+$/.test(k)) return t.includes(k);
  let from = 0;
  for (;;) {
    const i = t.indexOf(k, from);
    if (i < 0) return false;
    const before = i === 0 ? "" : t[i - 1]!, after = t[i + k.length] ?? "";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = i + 1;
  }
}
