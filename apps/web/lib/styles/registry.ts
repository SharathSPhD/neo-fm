/**
 * Indian music style taxonomy for genre routing (strategy/indian-music-styles.md).
 *
 * Data only: `styles-data.json` is generated from the research file and holds styles, ragas, talas, festivals and the
 * routing keyword map. Nothing in the generation path reads this yet; the PCE and station threads opt in through
 * `router.ts`. Vocabularies match `lib/pool/tags.ts`, which `tests/styles-registry.test.ts` enforces.
 */
import data from "./styles-data.json";

export type LyriaSupport = "good" | "ok" | "risky" | "untested" | "na" | "no";
export type LaunchPriority = "launch" | "launch-conditional" | "v1.1" | "wave2" | "later" | "excluded";

export interface MusicStyle {
  id: string;
  name: string;
  tradition: string;
  languages: string[];
  region: string;
  lyric_form: string;
  metre: string;
  instruments: string[];
  tempo_bpm: [number, number];
  energy: "low" | "mid" | "high";
  dayparts: string[];
  moods: string[];
  themes: string[];
  tala: string;
  raga_hint: string | null;
  /** One string, or a per-language map for cross-language styles such as lullabies. */
  lyria_hint_native: string | Record<string, string>;
  lyria_hint_en: string;
  lyria_vocal: LyriaSupport;
  lyria_instrumental: LyriaSupport;
  lyria_note: string;
  pce_sections: string[];
  must_avoid: string[];
  legacy_genre: string;
  launch_priority: LaunchPriority;
  sensitivity: string | null;
}

export interface Festival {
  festival: string;
  date_2026: string;
  regions: string;
  styles: string[];
  themes: string[];
  moods: string[];
}

export interface Routing {
  keyword_map: Record<string, string>;
  by_language: Record<string, string[]>;
  daypart_defaults: Record<string, string[]>;
}

export const STYLES = data.styles as unknown as MusicStyle[];
export const FESTIVALS = data.festivals as unknown as Festival[];
export const ROUTING = data.routing as unknown as Routing;
export const RAGAS = data.ragas;
export const TALAS = data.talas;

const BY_ID = new Map(STYLES.map((s) => [s.id, s]));

export function getStyle(id: string): MusicStyle | undefined {
  return BY_ID.get(id);
}

/** Styles that must never be generated (sacred scripture and the like). */
export function isGeneratable(s: MusicStyle): boolean {
  return s.launch_priority !== "excluded" && s.lyria_vocal !== "no";
}
