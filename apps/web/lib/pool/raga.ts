/**
 * Raga canon for pool tags (pool_tracks.raga). Council finding: raga was null on every admitted track, so a raga could
 * never drive dayparting. Tag a raga only when the song was made for it (document `raga.name`) or a reviewer set it; an
 * unrecognised name is dropped rather than stored, so the column stays a closed, joinable vocabulary.
 */
export interface RagaInfo {
  name: string;
  tradition: "hindustani" | "carnatic";
  dayparts: string[];
  moods: string[];
  aliases: string[];
}

/** Generated from strategy/indian-music-styles.json (ragas). Moods and dayparts use the pool vocabulary. */
export const RAGA_CANON: readonly RagaInfo[] = [
 {
  "name": "Bhairav",
  "tradition": "hindustani",
  "dayparts": [
   "dawn"
  ],
  "moods": [
   "devotional",
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Ahir Bhairav",
  "tradition": "hindustani",
  "dayparts": [
   "dawn",
   "morning"
  ],
  "moods": [
   "calm",
   "joyful"
  ],
  "aliases": []
 },
 {
  "name": "Lalit",
  "tradition": "hindustani",
  "dayparts": [
   "dawn"
  ],
  "moods": [
   "calm",
   "melancholic"
  ],
  "aliases": []
 },
 {
  "name": "Todi",
  "tradition": "hindustani",
  "dayparts": [
   "morning"
  ],
  "moods": [
   "melancholic",
   "devotional"
  ],
  "aliases": []
 },
 {
  "name": "Bhatiyar",
  "tradition": "hindustani",
  "dayparts": [
   "dawn"
  ],
  "moods": [
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Ramkali",
  "tradition": "hindustani",
  "dayparts": [
   "dawn"
  ],
  "moods": [
   "devotional"
  ],
  "aliases": []
 },
 {
  "name": "Bilawal",
  "tradition": "hindustani",
  "dayparts": [
   "morning"
  ],
  "moods": [
   "joyful",
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Alhaiya Bilawal",
  "tradition": "hindustani",
  "dayparts": [
   "morning"
  ],
  "moods": [
   "joyful",
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Deshkar",
  "tradition": "hindustani",
  "dayparts": [
   "morning"
  ],
  "moods": [
   "joyful",
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Bhoopali",
  "tradition": "hindustani",
  "dayparts": [
   "evening",
   "dusk"
  ],
  "moods": [
   "calm",
   "joyful"
  ],
  "aliases": [
   "Bhoop",
   "Bhup",
   "Bhopali"
  ]
 },
 {
  "name": "Yaman",
  "tradition": "hindustani",
  "dayparts": [
   "evening",
   "dusk",
   "night"
  ],
  "moods": [
   "romantic",
   "calm",
   "devotional"
  ],
  "aliases": []
 },
 {
  "name": "Marwa",
  "tradition": "hindustani",
  "dayparts": [
   "dusk"
  ],
  "moods": [
   "melancholic",
   "nostalgic"
  ],
  "aliases": []
 },
 {
  "name": "Puriya Dhanashri",
  "tradition": "hindustani",
  "dayparts": [
   "dusk"
  ],
  "moods": [
   "melancholic",
   "devotional"
  ],
  "aliases": [
   "Puriya"
  ]
 },
 {
  "name": "Shree",
  "tradition": "hindustani",
  "dayparts": [
   "dusk"
  ],
  "moods": [
   "devotional",
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Multani",
  "tradition": "hindustani",
  "dayparts": [
   "midday",
   "evening"
  ],
  "moods": [
   "melancholic",
   "romantic"
  ],
  "aliases": []
 },
 {
  "name": "Bhimpalasi",
  "tradition": "hindustani",
  "dayparts": [
   "midday",
   "evening"
  ],
  "moods": [
   "romantic",
   "nostalgic",
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Madhyamad Sarang",
  "tradition": "hindustani",
  "dayparts": [
   "midday"
  ],
  "moods": [
   "calm"
  ],
  "aliases": [
   "Sarang"
  ]
 },
 {
  "name": "Brindavani Sarang",
  "tradition": "hindustani",
  "dayparts": [
   "midday"
  ],
  "moods": [
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Kedar",
  "tradition": "hindustani",
  "dayparts": [
   "night"
  ],
  "moods": [
   "devotional",
   "romantic"
  ],
  "aliases": []
 },
 {
  "name": "Bihag",
  "tradition": "hindustani",
  "dayparts": [
   "night"
  ],
  "moods": [
   "romantic",
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Hameer",
  "tradition": "hindustani",
  "dayparts": [
   "night"
  ],
  "moods": [
   "romantic",
   "joyful"
  ],
  "aliases": []
 },
 {
  "name": "Darbari Kanada",
  "tradition": "hindustani",
  "dayparts": [
   "night"
  ],
  "moods": [
   "calm",
   "melancholic"
  ],
  "aliases": []
 },
 {
  "name": "Malkauns",
  "tradition": "hindustani",
  "dayparts": [
   "night"
  ],
  "moods": [
   "calm",
   "melancholic"
  ],
  "aliases": []
 },
 {
  "name": "Chandrakauns",
  "tradition": "hindustani",
  "dayparts": [
   "night"
  ],
  "moods": [
   "melancholic",
   "romantic"
  ],
  "aliases": []
 },
 {
  "name": "Bageshree",
  "tradition": "hindustani",
  "dayparts": [
   "night"
  ],
  "moods": [
   "romantic",
   "melancholic"
  ],
  "aliases": []
 },
 {
  "name": "Jaijaiwanti",
  "tradition": "hindustani",
  "dayparts": [
   "night"
  ],
  "moods": [
   "melancholic",
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Desh",
  "tradition": "hindustani",
  "dayparts": [
   "night",
   "evening"
  ],
  "moods": [
   "romantic",
   "nostalgic",
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Miyan ki Malhar",
  "tradition": "hindustani",
  "dayparts": [
   "evening"
  ],
  "moods": [
   "romantic",
   "joyful",
   "nostalgic"
  ],
  "aliases": [
   "Malhar",
   "Miyan Malhar",
   "Megh Malhar"
  ]
 },
 {
  "name": "Megh",
  "tradition": "hindustani",
  "dayparts": [
   "evening"
  ],
  "moods": [
   "romantic",
   "joyful",
   "nostalgic"
  ],
  "aliases": []
 },
 {
  "name": "Gaud Malhar",
  "tradition": "hindustani",
  "dayparts": [
   "evening"
  ],
  "moods": [
   "romantic",
   "joyful",
   "nostalgic"
  ],
  "aliases": []
 },
 {
  "name": "Basant",
  "tradition": "hindustani",
  "dayparts": [
   "morning"
  ],
  "moods": [
   "joyful",
   "festive"
  ],
  "aliases": []
 },
 {
  "name": "Bahar",
  "tradition": "hindustani",
  "dayparts": [
   "morning"
  ],
  "moods": [
   "joyful",
   "festive"
  ],
  "aliases": []
 },
 {
  "name": "Hindol",
  "tradition": "hindustani",
  "dayparts": [
   "morning"
  ],
  "moods": [
   "joyful",
   "festive"
  ],
  "aliases": []
 },
 {
  "name": "Kafi",
  "tradition": "hindustani",
  "dayparts": [
   "evening"
  ],
  "moods": [
   "playful",
   "romantic",
   "joyful"
  ],
  "aliases": []
 },
 {
  "name": "Khamaj",
  "tradition": "hindustani",
  "dayparts": [
   "evening"
  ],
  "moods": [
   "playful",
   "romantic",
   "joyful"
  ],
  "aliases": []
 },
 {
  "name": "Pilu",
  "tradition": "hindustani",
  "dayparts": [
   "evening"
  ],
  "moods": [
   "playful",
   "romantic",
   "joyful"
  ],
  "aliases": []
 },
 {
  "name": "Pahadi",
  "tradition": "hindustani",
  "dayparts": [
   "evening"
  ],
  "moods": [
   "playful",
   "romantic",
   "joyful"
  ],
  "aliases": []
 },
 {
  "name": "Bhairavi",
  "tradition": "hindustani",
  "dayparts": [
   "morning",
   "night"
  ],
  "moods": [
   "devotional",
   "melancholic"
  ],
  "aliases": []
 },
 {
  "name": "Mayamalavagowla",
  "tradition": "carnatic",
  "dayparts": [
   "dawn"
  ],
  "moods": [
   "devotional",
   "calm"
  ],
  "aliases": [
   "Mayamalavagaula",
   "Mayamalavagowlai"
  ]
 },
 {
  "name": "Bhoopalam",
  "tradition": "carnatic",
  "dayparts": [
   "dawn",
   "morning"
  ],
  "moods": [
   "devotional",
   "joyful"
  ],
  "aliases": [
   "Bhupalam"
  ]
 },
 {
  "name": "Bilahari",
  "tradition": "carnatic",
  "dayparts": [
   "dawn",
   "morning"
  ],
  "moods": [
   "devotional",
   "joyful"
  ],
  "aliases": []
 },
 {
  "name": "Hamsadhwani",
  "tradition": "carnatic",
  "dayparts": [
   "morning"
  ],
  "moods": [
   "joyful",
   "festive"
  ],
  "aliases": []
 },
 {
  "name": "Mohanam",
  "tradition": "carnatic",
  "dayparts": [
   "evening"
  ],
  "moods": [
   "joyful",
   "calm"
  ],
  "aliases": [
   "Mohana"
  ]
 },
 {
  "name": "Shankarabharanam",
  "tradition": "carnatic",
  "dayparts": [
   "morning"
  ],
  "moods": [
   "joyful",
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Kalyani",
  "tradition": "carnatic",
  "dayparts": [
   "evening",
   "dusk"
  ],
  "moods": [
   "calm",
   "romantic"
  ],
  "aliases": []
 },
 {
  "name": "Kharaharapriya",
  "tradition": "carnatic",
  "dayparts": [
   "evening"
  ],
  "moods": [
   "melancholic",
   "romantic"
  ],
  "aliases": []
 },
 {
  "name": "Anandabhairavi",
  "tradition": "carnatic",
  "dayparts": [
   "night"
  ],
  "moods": [
   "calm",
   "nostalgic"
  ],
  "aliases": []
 },
 {
  "name": "Neelambari",
  "tradition": "carnatic",
  "dayparts": [
   "night"
  ],
  "moods": [
   "calm"
  ],
  "aliases": []
 },
 {
  "name": "Madhyamavati",
  "tradition": "carnatic",
  "dayparts": [
   "midday",
   "dusk"
  ],
  "moods": [
   "calm",
   "devotional"
  ],
  "aliases": []
 },
 {
  "name": "Kambhoji",
  "tradition": "carnatic",
  "dayparts": [
   "dusk"
  ],
  "moods": [
   "devotional",
   "melancholic"
  ],
  "aliases": []
 },
 {
  "name": "Sindhu Bhairavi",
  "tradition": "carnatic",
  "dayparts": [
   "night"
  ],
  "moods": [
   "romantic",
   "melancholic"
  ],
  "aliases": []
 },
 {
  "name": "Hindolam",
  "tradition": "carnatic",
  "dayparts": [
   "night"
  ],
  "moods": [
   "calm",
   "melancholic"
  ],
  "aliases": []
 }
];

/** Lowercase, drop diacritics and the words raga/raag/ragam, collapse spaces: "Raag Yaman" and "yaman" compare equal. */
function key(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(raga|raag|ragam|rag)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

const BY_KEY = new Map<string, RagaInfo>();
for (const r of RAGA_CANON) {
  BY_KEY.set(key(r.name), r);
  for (const a of r.aliases) if (!BY_KEY.has(key(a))) BY_KEY.set(key(a), r);
}

export function ragaInfo(name: string | null | undefined): RagaInfo | null {
  return name ? BY_KEY.get(key(name)) ?? null : null;
}

/** Canonical display name for a free-text raga, or null when it is not in the canon. */
export function normalizeRaga(name: string | null | undefined): string | null {
  return ragaInfo(name)?.name ?? null;
}

/** Ragas that suit a daypart (and optionally a mood and tradition), best-fitting first. Deterministic. */
export function ragasFor(q: { daypart?: string; mood?: string; tradition?: "hindustani" | "carnatic" }): RagaInfo[] {
  return RAGA_CANON
    .filter((r) => !q.tradition || r.tradition === q.tradition)
    .map((r) => ({ r, s: (q.daypart && r.dayparts.includes(q.daypart) ? 2 : 0) + (q.mood && r.moods.includes(q.mood) ? 1 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.r.name.localeCompare(b.r.name))
    .map((x) => x.r);
}
