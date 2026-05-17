/**
 * v1.4 Sprint 4: 12-raga catalogue surfaced by the creation canvas's
 * Advanced disclosure. The list is deliberately small — these are the
 * "every-singer-knows-them" ragas that account for ~80% of the
 * Bhavageete + Tamil-folk + Carnatic / Hindustani repertoire we're
 * about to seed Discover with. The user can still type a custom raga
 * name; the catalogue just gives a one-click pick that auto-fills the
 * suggested tala and instrumentation hint.
 *
 * Sources cross-referenced for canonical names and arohana/avarohana:
 *   - the Carnatic / Hindustani textbooks bundled in research/
 *   - the existing co-composer raga maps under
 *     `packages/co-composer/src/{carnatic,hindustani}.ts`
 *
 * The catalogue is plain data, no zod — the SongDocument schema
 * validates the raga shape downstream. Anything we add here is purely a
 * UX affordance.
 */

import type { RagaSpec } from "@neo-fm/song-doc";

export type RagaSystem = RagaSpec["system"];

export interface RagaCatalogueEntry {
  /** Canonical, all-lowercase name; what we POST to the API. */
  name: string;
  /** Pretty label for the UI. */
  label: string;
  system: RagaSystem;
  /** Suggested tala. The user can override. */
  suggestedTala?: string;
  /** Mood hint shown next to the picker — pure UX. */
  mood?: string;
  /** True if the raga is also valid for kannada-light-classical. */
  bhavageeteFriendly?: boolean;
}

export const RAGA_CATALOGUE: readonly RagaCatalogueEntry[] = [
  {
    name: "mayamalavagowla",
    label: "Mayamalavagowla",
    system: "carnatic",
    suggestedTala: "adi",
    mood: "Devotional, foundational. The first raga every Carnatic student learns.",
  },
  {
    name: "kalyani",
    label: "Kalyani",
    system: "carnatic",
    suggestedTala: "adi",
    mood: "Bright, regal. Lydian-coloured; suits triumph and morning pieces.",
    bhavageeteFriendly: true,
  },
  {
    name: "mohanam",
    label: "Mohanam",
    system: "carnatic",
    suggestedTala: "adi",
    mood: "Pentatonic, joyful. The lullaby raga; ubiquitous in bhavageete.",
    bhavageeteFriendly: true,
  },
  {
    name: "saveri",
    label: "Saveri",
    system: "carnatic",
    suggestedTala: "rupaka",
    mood: "Pleading, devotional. A classic dawn raga.",
  },
  {
    name: "hindolam",
    label: "Hindolam",
    system: "carnatic",
    suggestedTala: "adi",
    mood: "Pentatonic, meditative. Counterpart to mohanam; ideal for solo voice.",
    bhavageeteFriendly: true,
  },
  {
    name: "shankarabharanam",
    label: "Shankarabharanam",
    system: "carnatic",
    suggestedTala: "adi",
    mood: "Major-scale, formal. The Carnatic 'Ionian'.",
  },
  {
    name: "yaman",
    label: "Yaman",
    system: "hindustani",
    suggestedTala: "teentaal",
    mood: "Romantic, evening. The Hindustani 'first raga'; lydian colour.",
  },
  {
    name: "bhairavi",
    label: "Bhairavi",
    system: "hindustani",
    suggestedTala: "teentaal",
    mood: "Plaintive, devotional. Often closes a concert.",
  },
  {
    name: "bhupali",
    label: "Bhupali",
    system: "hindustani",
    suggestedTala: "jhaptaal",
    mood: "Pentatonic, calm. The Hindustani sibling of mohanam.",
  },
  {
    name: "kafi",
    label: "Kafi",
    system: "hindustani",
    suggestedTala: "teentaal",
    mood: "Folk-leaning, dorian colour. The base raga for thumri.",
  },
  {
    name: "khamaj",
    label: "Khamaj",
    system: "hindustani",
    suggestedTala: "teentaal",
    mood: "Mixolydian, light-classical staple. Common in Rabindrasangeet.",
  },
  {
    name: "desh",
    label: "Desh",
    system: "hindustani",
    suggestedTala: "teentaal",
    mood: "Monsoon, patriotic. Khamaj-family, popular in Bengali light-classical.",
  },
];

/**
 * 8-tala catalogue surfaced by the picker. Adi/Roopaka/Eka/Mishra Chapu
 * are Carnatic; Teentaal/Jhaptaal/Roopak/Ektaal are Hindustani.
 */
export interface TalaCatalogueEntry {
  name: string;
  label: string;
  /** Which raga system this tala is typically used with. */
  family: "carnatic" | "hindustani";
  /** Beats per cycle (display only). */
  beats: number;
}

export const TALA_CATALOGUE: readonly TalaCatalogueEntry[] = [
  { name: "adi", label: "Adi", family: "carnatic", beats: 8 },
  { name: "rupaka", label: "Roopaka", family: "carnatic", beats: 6 },
  { name: "eka", label: "Eka", family: "carnatic", beats: 4 },
  { name: "mishra-chapu", label: "Mishra Chapu", family: "carnatic", beats: 7 },
  { name: "teentaal", label: "Teentaal", family: "hindustani", beats: 16 },
  { name: "jhaptaal", label: "Jhaptaal", family: "hindustani", beats: 10 },
  { name: "rupak", label: "Roopak", family: "hindustani", beats: 7 },
  { name: "ektaal", label: "Ektaal", family: "hindustani", beats: 12 },
];

/**
 * Per-style instrument shortlist. The Advanced disclosure renders these
 * as multi-select chips. Instruments outside the shortlist are still
 * permitted (the song-doc schema accepts any string) — the catalogue is
 * a UX assist for the 95% case.
 */
export const INSTRUMENT_CATALOGUE: Record<string, readonly string[]> = {
  western: ["acoustic-guitar", "piano", "drums", "bass", "strings", "synth-pad"],
  carnatic: ["mridangam", "tanpura", "violin", "ghatam", "kanjira", "veena"],
  hindustani: ["tabla", "tanpura", "sarangi", "harmonium", "sitar", "bansuri"],
  "kannada-folk": ["dhol", "harmonium", "tambourine", "shehnai", "tabla"],
  "kannada-light-classical": ["tanpura", "harmonium", "tabla", "violin", "flute"],
  "tamil-folk": ["parai", "thavil", "nadaswaram", "udukai", "harmonium"],
  "bollywood-ballad": ["acoustic-guitar", "piano", "tabla", "strings", "flute"],
  "bengali-rabindrasangeet": ["esraj", "tabla", "harmonium", "tanpura", "flute"],
  "telugu-keerthana": ["mridangam", "tanpura", "violin", "ghatam"],
  "sanskrit-shloka": ["tanpura", "harmonium", "bell"],
};

/**
 * Find a raga catalogue entry by canonical name. Returns null when the
 * name is custom (user-typed) so the caller can fall back to a generic
 * "user-typed raga" presentation.
 */
export function findRaga(name: string): RagaCatalogueEntry | null {
  const needle = name.trim().toLowerCase();
  return RAGA_CATALOGUE.find((r) => r.name === needle) ?? null;
}

/**
 * Filter the raga catalogue by `style_family`. Used by the creation
 * canvas to scope the dropdown to a relevant subset.
 */
export function ragasForStyle(
  style: string,
): readonly RagaCatalogueEntry[] {
  switch (style) {
    case "carnatic":
    case "telugu-keerthana":
    case "sanskrit-shloka":
      return RAGA_CATALOGUE.filter((r) => r.system === "carnatic");
    case "hindustani":
      return RAGA_CATALOGUE.filter((r) => r.system === "hindustani");
    case "kannada-light-classical":
      return RAGA_CATALOGUE.filter(
        (r) => r.bhavageeteFriendly || r.system === "carnatic",
      );
    case "bengali-rabindrasangeet":
      return RAGA_CATALOGUE.filter((r) => r.system === "hindustani");
    case "kannada-folk":
    case "tamil-folk":
    case "western":
    case "bollywood-ballad":
    default:
      return [];
  }
}

/**
 * Filter the tala catalogue by raga system. Used so the tala picker
 * only shows the relevant 4 talas after the user selects a raga.
 */
export function talasForSystem(
  system: RagaSystem | undefined,
): readonly TalaCatalogueEntry[] {
  if (system === "carnatic" || system === "light-classical") {
    return TALA_CATALOGUE.filter((t) => t.family === "carnatic");
  }
  if (system === "hindustani") {
    return TALA_CATALOGUE.filter((t) => t.family === "hindustani");
  }
  return TALA_CATALOGUE;
}
