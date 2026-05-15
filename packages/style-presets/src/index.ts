/**
 * Curated Song Document presets surfaced as "templates" in the creation
 * canvas (M3). Each preset is a hand-crafted starting point a user can
 * customise. They double as smoke fixtures for E2E demos -- the Gate G1
 * verification picks 4 of these and generates them through the live
 * pipeline.
 *
 * Each preset:
 *   - is a complete, validated SongDocument (or one round-trippable
 *     through `SongDocumentSchema.parse`).
 *   - links to a PD lyric from `data/public-lyrics/` when the lyrical
 *     content is the central piece (Tagore, Kabir). For
 *     instrumental-leaning presets the lyrics field is left blank and
 *     HeartMuLa is asked to drive the section through orchestration.
 *
 * The pickable list is exported as `PRESETS`. Order is curated to put
 * Indian-origin presets first so the gallery surface emphasises the
 * "India-first" positioning.
 */

import {
  SongDocumentSchema,
  type SongDocument,
} from "@neo-fm/song-doc";

export interface StylePreset {
  /** Stable id used by the UI and as a logging key. */
  readonly id: string;
  /** Human label shown on the gallery card. */
  readonly title: string;
  /** Short sub-line on the card. */
  readonly subtitle: string;
  /** 1-2 sentence description shown on hover / details panel. */
  readonly description: string;
  /** 2-3 keyword chips on the card. */
  readonly chips: readonly string[];
  /** Source attribution for any embedded lyric. */
  readonly lyric_source?: {
    readonly title: string;
    readonly author: string;
    readonly note: string;
  };
  /** The Song Document the user gets when they pick this card. */
  readonly song_document: SongDocument;
}

// ---- Presets -------------------------------------------------------------

// Helper to keep the literal docs concise; we round-trip through Zod to
// catch any drift at import time (this file's tests assert it parses).
function preset<T extends StylePreset>(p: T): T {
  // Throws synchronously on shape errors -- caught at module load.
  SongDocumentSchema.parse(p.song_document);
  return p;
}

export const CARNATIC_KRITI = preset({
  id: "carnatic-kriti",
  title: "Carnatic kriti",
  subtitle: "Raga Kalyani, Adi tala",
  description:
    "A devotional kriti opener in Kalyani, set to the classic 8-beat Adi tala. Mridangam + tanpura + violin trio.",
  chips: ["Carnatic", "Kalyani", "Adi"],
  song_document: {
    language: "hi",
    style_family: "carnatic",
    tempo_bpm: 80,
    target_duration_seconds: 90,
    tala: "adi",
    raga: {
      name: "kalyani",
      system: "carnatic",
    },
    orchestration: {
      lead_vocal: "female",
      instruments: ["mridangam", "tanpura", "violin"],
      texture: "drone+lead+percussion",
    },
    sections: [
      { id: "p1", type: "pallavi", target_seconds: 30 },
      { id: "a1", type: "anupallavi", target_seconds: 30 },
      { id: "c1", type: "charanam", target_seconds: 30 },
    ],
  },
});

export const HINDUSTANI_KHAYAL_SKETCH = preset({
  id: "hindustani-khayal-sketch",
  title: "Hindustani khayal",
  subtitle: "Raga Yaman, Teentaal",
  description:
    "Late-evening Yaman khayal sketch. Slow alaap opener, mukhda statement, antara development. Harmonium + tabla + tanpura.",
  chips: ["Hindustani", "Yaman", "Teentaal"],
  song_document: {
    language: "hi",
    style_family: "hindustani",
    tempo_bpm: 90,
    target_duration_seconds: 90,
    tala: "teentaal",
    raga: {
      name: "yaman",
      system: "hindustani",
    },
    orchestration: {
      lead_vocal: "female",
      instruments: ["harmonium", "tabla", "tanpura"],
      texture: "drone+lead+percussion",
    },
    sections: [
      { id: "alaap", type: "alaap", target_seconds: 30 },
      { id: "mukhda", type: "mukhda", target_seconds: 30 },
      { id: "antara", type: "antara", target_seconds: 30 },
    ],
  },
});

export const KANNADA_BHAVAGEETE = preset({
  id: "kannada-bhavageete",
  title: "Kannada bhavageete",
  subtitle: "6/8 lyric song",
  description:
    "A Kannada lyric song in compound duple time. Flute lead over dhol + tabla + percussion. Lyrics in Kannada script.",
  chips: ["Kannada-folk", "Bhavageete", "6/8"],
  song_document: {
    language: "kn",
    style_family: "kannada-folk",
    tempo_bpm: 110,
    time_signature: "6/8",
    target_duration_seconds: 90,
    orchestration: {
      lead_vocal: "female",
      instruments: ["dhol", "flute", "tabla", "percussion"],
      texture: "lead+rhythm",
    },
    sections: [
      {
        id: "r1",
        type: "folk_refrain",
        target_seconds: 30,
        lyrics: "ಮಲೆನಾಡ ಮಳೆಯ ಸಂಜೆ",
        script: "kannada",
      },
      {
        id: "s1",
        type: "folk_stanza",
        target_seconds: 30,
      },
      {
        id: "r2",
        type: "folk_refrain",
        target_seconds: 30,
      },
    ],
    metadata: { genre: "bhavageete" },
  },
});

export const KABIR_DOHA = preset({
  id: "kabir-doha",
  title: "Kabir doha",
  subtitle: "Hindustani, Raga Bhairavi",
  description:
    "A two-line Kabir doha rendered in raga Bhairavi. Devotional, slow-tempo, harmonium + tabla. Public domain lyric.",
  chips: ["Hindustani", "Bhairavi", "Devotional"],
  lyric_source: {
    title: "Pothi padhi padhi jag mua",
    author: "Kabir (15th c.)",
    note: "Public domain. From data/public-lyrics/kabir/.",
  },
  song_document: {
    language: "hi",
    style_family: "hindustani",
    tempo_bpm: 70,
    target_duration_seconds: 90,
    tala: "dadra",
    raga: {
      name: "bhairavi",
      system: "hindustani",
    },
    orchestration: {
      lead_vocal: "male",
      instruments: ["harmonium", "tabla", "tanpura"],
      texture: "drone+lead",
    },
    sections: [
      {
        id: "doha1",
        type: "mukhda",
        target_seconds: 45,
        lyrics: "पोथी पढि पढि जग मुआ",
        transliteration: "Pothi padhi padhi jag mua",
        script: "devanagari",
        language: "hi",
      },
      {
        id: "doha2",
        type: "antara",
        target_seconds: 45,
        lyrics: "पंडित भया न कोय",
        transliteration: "Pandit bhaya na koy",
        script: "devanagari",
        language: "hi",
      },
    ],
  },
});

export const TAGORE_SET = preset({
  id: "tagore-set",
  title: "Tagore set",
  subtitle: "English Rabindrasangeet hybrid",
  description:
    "A Tagore Gitanjali line set to Western chord changes -- the cross-cultural hybrid that Tagore himself often performed. Acoustic guitar + flute.",
  chips: ["Western", "Tagore", "Lyric"],
  lyric_source: {
    title: "Where the mind is without fear",
    author: "Rabindranath Tagore (Gitanjali 35, 1910)",
    note: "Public domain. English translation by the author.",
  },
  song_document: {
    language: "en",
    style_family: "western",
    tempo_bpm: 78,
    time_signature: "4/4",
    target_duration_seconds: 90,
    orchestration: {
      lead_vocal: "male",
      instruments: ["acoustic_guitar", "flute", "upright_bass"],
      texture: "lead+rhythm",
    },
    sections: [
      {
        id: "v1",
        type: "verse",
        target_seconds: 30,
        lyrics: "Where the mind is without fear and the head is held high",
        script: "latin",
        language: "en",
      },
      {
        id: "v2",
        type: "verse",
        target_seconds: 30,
        lyrics: "Where knowledge is free, where the world has not been broken",
        script: "latin",
        language: "en",
      },
      {
        id: "c1",
        type: "chorus",
        target_seconds: 30,
        lyrics: "Into that heaven of freedom, my Father, let my country awake",
        script: "latin",
        language: "en",
      },
    ],
    metadata: { key: "D" },
  },
});

export const BOLLYWOOD_BALLAD = preset({
  id: "bollywood-ballad",
  title: "Bollywood ballad",
  subtitle: "Hindi, Western chords + Indian instrumentation",
  description:
    "A slow-tempo Bollywood ballad. Western verse-chorus-verse with a sitar and tabla layered over piano + strings.",
  chips: ["Western", "Bollywood", "Crossover"],
  song_document: {
    language: "hi",
    style_family: "western",
    tempo_bpm: 75,
    time_signature: "4/4",
    target_duration_seconds: 90,
    orchestration: {
      lead_vocal: "female",
      instruments: ["piano", "strings", "sitar", "tabla"],
      texture: "full-band",
    },
    sections: [
      { id: "v1", type: "verse", target_seconds: 30 },
      { id: "c1", type: "chorus", target_seconds: 30 },
      { id: "v2", type: "verse", target_seconds: 30 },
    ],
    metadata: { key: "F" },
  },
});

export const TAMIL_FOLK = preset({
  id: "tamil-folk",
  title: "Tamil folk",
  subtitle: "Janapada-style 4/4 dance",
  description:
    "An upbeat Tamil-leaning folk dance, 4/4 time with parai-style percussion and flute lead. Lyrics in Tamil-script transliteration (full Tamil rendering arrives in Phase 7 vocal synth).",
  chips: ["Kannada-folk", "Janapada", "Dance"],
  song_document: {
    // Tamil is not in the v1 LanguageSchema (en/hi/kn) yet; the
    // user can still set `script:tamil` per section. We park this
    // preset under `language:en` for the v1 router and tag the
    // script + genre via metadata, so downstream rendering knows
    // to use Tamil-script when set. Phase 7 broadens the language
    // enum; the preset migrates without churn.
    language: "en",
    style_family: "kannada-folk",
    tempo_bpm: 124,
    time_signature: "4/4",
    target_duration_seconds: 90,
    orchestration: {
      lead_vocal: "male",
      instruments: ["dhol", "flute", "tabla", "percussion"],
      texture: "lead+rhythm",
    },
    sections: [
      { id: "r1", type: "folk_refrain", target_seconds: 30 },
      { id: "s1", type: "folk_stanza", target_seconds: 30 },
      { id: "r2", type: "folk_refrain", target_seconds: 30 },
    ],
    metadata: { genre: "janapada", language_hint: "ta" },
  },
});

export const WESTERN_POP = preset({
  id: "western-pop",
  title: "Western pop",
  subtitle: "Upbeat 4/4 in C major",
  description:
    "A radio-pop verse-chorus-verse-chorus structure in C major. Full band: acoustic guitar, bass, drums.",
  chips: ["Western", "Pop", "Major"],
  song_document: {
    language: "en",
    style_family: "western",
    tempo_bpm: 118,
    time_signature: "4/4",
    target_duration_seconds: 90,
    orchestration: {
      lead_vocal: "female",
      instruments: ["acoustic_guitar", "bass", "drums"],
      texture: "full-band",
    },
    sections: [
      { id: "v1", type: "verse", target_seconds: 22 },
      { id: "c1", type: "chorus", target_seconds: 23 },
      { id: "v2", type: "verse", target_seconds: 22 },
      { id: "c2", type: "chorus", target_seconds: 23 },
    ],
    metadata: { key: "C" },
  },
});

// India-first ordering: Indian-origin presets up top, crossover next,
// pure Western pop last.
export const PRESETS: readonly StylePreset[] = [
  CARNATIC_KRITI,
  HINDUSTANI_KHAYAL_SKETCH,
  KANNADA_BHAVAGEETE,
  KABIR_DOHA,
  TAGORE_SET,
  BOLLYWOOD_BALLAD,
  TAMIL_FOLK,
  WESTERN_POP,
];

export function findPreset(id: string): StylePreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
