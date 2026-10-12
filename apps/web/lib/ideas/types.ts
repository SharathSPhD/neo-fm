/** Starter-idea gallery: shared types, labels and pure helpers. Client-safe (no data, no server imports). */

export const IDEA_LANGS = ["hi", "kn", "ta", "te", "bn"] as const;
export type IdeaLang = (typeof IDEA_LANGS)[number];

export const OCCASIONS = ["festival", "lullaby", "love", "devotion", "monsoon", "cricket", "wedding", "city-life"] as const;
export type Occasion = (typeof OCCASIONS)[number];

export const MOODS = ["joyful", "tender", "wistful", "playful", "devotional", "energetic"] as const;
export type Mood = (typeof MOODS)[number];

export const OCCASION_LABEL: Record<Occasion, string> = {
  festival: "Festivals",
  lullaby: "Lullabies",
  love: "Love",
  devotion: "Devotion",
  monsoon: "Monsoon",
  cricket: "Cricket",
  wedding: "Weddings",
  "city-life": "City life",
};

export const MOOD_LABEL: Record<Mood, string> = {
  joyful: "Joyful",
  tender: "Tender",
  wistful: "Wistful",
  playful: "Playful",
  devotional: "Devotional",
  energetic: "Energetic",
};

export const IDEA_LANG_NAME: Record<IdeaLang, { name: string; endonym: string }> = {
  hi: { name: "Hindi", endonym: "हिन्दी" },
  kn: { name: "Kannada", endonym: "ಕನ್ನಡ" },
  ta: { name: "Tamil", endonym: "தமிழ்" },
  te: { name: "Telugu", endonym: "తెలుగు" },
  bn: { name: "Bengali", endonym: "বাংলা" },
};

export interface Idea {
  /** Stable id, e.g. `kn-festival-1`. Used in `/songs/new?idea=<id>`; never change an id once shipped. */
  id: string;
  lang: IdeaLang;
  occasion: Occasion;
  mood: Mood;
  /** The prompt, in the language's own script. At most PROMPT_LIMIT characters so it fits the create box. */
  text: string;
  /** English gloss for people who do not read the script. */
  gloss: string;
}

/** The create box accepts 500 characters; ideas stay well under so users can add to them. */
export const PROMPT_LIMIT = 300;

export function isIdeaLang(v: unknown): v is IdeaLang {
  return typeof v === "string" && (IDEA_LANGS as readonly string[]).includes(v);
}

export function filterIdeas(ideas: readonly Idea[], f: { occasion?: Occasion | null; mood?: Mood | null }): Idea[] {
  return ideas.filter((i) => (!f.occasion || i.occasion === f.occasion) && (!f.mood || i.mood === f.mood));
}

/** Facet counts for the filter chips, computed against the other active filter so chips never lead to an empty list. */
export function facetCounts(ideas: readonly Idea[], f: { occasion?: Occasion | null; mood?: Mood | null }) {
  const occasion = Object.fromEntries(OCCASIONS.map((o) => [o, 0])) as Record<Occasion, number>;
  const mood = Object.fromEntries(MOODS.map((m) => [m, 0])) as Record<Mood, number>;
  for (const i of ideas) {
    if (!f.mood || i.mood === f.mood) occasion[i.occasion]++;
    if (!f.occasion || i.occasion === f.occasion) mood[i.mood]++;
  }
  return { occasion, mood };
}
