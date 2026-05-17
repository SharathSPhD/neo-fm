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
  subtitle: "Light-classical lyric song",
  description:
    "Sugama-sangeetha: a Kannada light-classical lyric song. Mid-tempo, harmonium-led, tabla + tanpura + flute. Not a folk song — bhavageete sits between Hindustani lyric form and Janapada folk.",
  chips: ["Kannada", "Light-classical", "Sugama sangeetha"],
  song_document: {
    language: "kn",
    style_family: "kannada-light-classical",
    tempo_bpm: 88,
    time_signature: "6/8",
    target_duration_seconds: 90,
    orchestration: {
      lead_vocal: "female",
      instruments: ["harmonium", "tabla", "tanpura", "flute"],
      texture: "lead+rhythm+drone",
    },
    sections: [
      {
        id: "p1",
        type: "pallavi",
        target_seconds: 30,
        lyrics: "ಮಲೆನಾಡ ಮಳೆಯ ಸಂಜೆ",
        script: "kannada",
      },
      {
        id: "c1",
        type: "charanam",
        target_seconds: 30,
      },
      {
        id: "p2",
        type: "pallavi",
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
  subtitle: "Janapada dance, parai-driven 4/4",
  description:
    "An upbeat Tamil folk dance. 4/4 parai pulse, nadaswaram + thavil + flute, male lead. Now routes through the dedicated TamilFolkCoComposer with native Tamil language support.",
  chips: ["Tamil", "Janapada", "Folk dance"],
  song_document: {
    // v1.3 Sprint 2: Tamil joined LanguageSchema and we have a
    // dedicated tamil-folk style family. The preset no longer needs
    // language_hint or to masquerade as Kannada folk.
    language: "ta",
    style_family: "tamil-folk",
    tempo_bpm: 124,
    time_signature: "4/4",
    target_duration_seconds: 90,
    orchestration: {
      lead_vocal: "male",
      instruments: ["parai", "thavil", "nadaswaram", "flute"],
      texture: "percussion+lead",
    },
    sections: [
      { id: "r1", type: "folk_refrain", target_seconds: 30, script: "tamil" },
      { id: "s1", type: "folk_stanza", target_seconds: 30, script: "tamil" },
      { id: "r2", type: "folk_refrain", target_seconds: 30, script: "tamil" },
    ],
    metadata: { genre: "janapada", region: "tamil" },
  },
});

export const SANSKRIT_SHLOKA = preset({
  id: "sanskrit-shloka",
  title: "Sanskrit shloka",
  subtitle: "Vedic chant, slow sustained vowels",
  description:
    "A Vedic devotional shloka chanted on a tanpura drone bed. Slow tempo, sustained-vowel udatta emphasis, anudatta/svarita prosody — Sprint 14's chant-style LoRA shapes the pitch and the always-on envelope pass shapes the duration. Section types are pulled from the Vedic shloka tradition (shloka_verse, shloka_refrain, phalashruti).",
  chips: ["Sanskrit", "Vedic chant", "Devotional"],
  lyric_source: {
    title: "Om namo bhagavate vasudevaya (Dvadashakshara)",
    author: "Vedic tradition (anonymous)",
    note: "Public domain. Canonical Devanagari from the Sanskrit Documents Archive.",
  },
  song_document: {
    language: "sa",
    style_family: "sanskrit-shloka",
    tempo_bpm: 60,
    target_duration_seconds: 90,
    raga: {
      name: "bhairavi",
      system: "carnatic",
    },
    orchestration: {
      lead_vocal: "male",
      instruments: ["tanpura", "harmonium"],
      texture: "drone+lead",
    },
    sections: [
      {
        id: "v1",
        type: "shloka_verse",
        target_seconds: 30,
        voice_id: "chant_sustained",
        lyrics: "\u0950 \u0928\u092e\u094b \u092d\u0917\u0935\u0924\u0947 \u0935\u093e\u0938\u0941\u0926\u0947\u0935\u093e\u092f",
        transliteration: "om namo bhagavate vasudevaya",
        script: "devanagari",
        language: "sa",
      },
      {
        id: "r1",
        type: "shloka_refrain",
        target_seconds: 30,
        voice_id: "chant_sustained",
        lyrics: "\u0950 \u0928\u092e\u094b \u092d\u0917\u0935\u0924\u0947",
        transliteration: "om namo bhagavate",
        script: "devanagari",
        language: "sa",
      },
      {
        id: "p1",
        type: "phalashruti",
        target_seconds: 30,
        voice_id: "chant_devotional",
        lyrics: "\u0907\u0924\u093f \u0938\u0902\u092a\u0942\u0930\u094d\u0923\u092e\u094d",
        transliteration: "iti sampurnam",
        script: "devanagari",
        language: "sa",
      },
    ],
    metadata: { genre: "shloka" },
  },
});

export const BENGALI_RABINDRASANGEET = preset({
  id: "bengali-rabindrasangeet",
  title: "Bengali Rabindrasangeet",
  subtitle: "Tagore song-form, raga-tinged lyric",
  description:
    "A Bengali Rabindrasangeet — Tagore's own song-form. Slow-to-moderate tempo, esraj + harmonium + tabla, sustained vowels. Voices route to IndicF5 for native-Bengali pronunciation. HeartMuLa baseline drives the orchestration.",
  chips: ["Bengali", "Rabindrasangeet", "Lyric"],
  lyric_source: {
    title: "Amar shonar Bangla (opening line)",
    author: "Rabindranath Tagore (1905)",
    note: "Public domain. National anthem of Bangladesh; original Bengali Devanagari.",
  },
  song_document: {
    language: "bn",
    style_family: "bengali-rabindrasangeet",
    tempo_bpm: 72,
    target_duration_seconds: 90,
    raga: {
      name: "bilawal",
      system: "hindustani",
    },
    orchestration: {
      lead_vocal: "female",
      instruments: ["esraj", "harmonium", "tabla", "tanpura"],
      texture: "lead+rhythm+drone",
    },
    sections: [
      {
        id: "v1",
        type: "mukhda",
        target_seconds: 30,
        voice_id: "indic_bn_female",
        lyrics: "\u0986\u09ae\u09be\u09b0 \u09b8\u09cb\u09a8\u09be\u09b0 \u09ac\u09be\u0982\u09b2\u09be",
        transliteration: "Amar shonar Bangla",
        script: "bengali",
        language: "bn",
      },
      {
        id: "a1",
        type: "antara",
        target_seconds: 30,
        voice_id: "indic_bn_female",
        script: "bengali",
        language: "bn",
      },
      {
        id: "v2",
        type: "mukhda",
        target_seconds: 30,
        voice_id: "indic_bn_female",
        script: "bengali",
        language: "bn",
      },
    ],
    metadata: { genre: "rabindrasangeet" },
  },
});

export const TELUGU_KEERTHANA = preset({
  id: "telugu-keerthana",
  title: "Telugu keerthana",
  subtitle: "Carnatic devotional, raga Mohanam",
  description:
    "A Telugu Carnatic keerthana set to raga Mohanam (pentatonic) and Adi tala. Mridangam + violin + tanpura; voice routes through IndicF5 for native-Telugu prosody. MusicGen+Carnatic LoRA drives the orchestration.",
  chips: ["Telugu", "Carnatic", "Keerthana"],
  song_document: {
    language: "te",
    style_family: "telugu-keerthana",
    tempo_bpm: 82,
    target_duration_seconds: 90,
    tala: "adi",
    raga: {
      name: "mohanam",
      system: "carnatic",
    },
    orchestration: {
      lead_vocal: "male",
      instruments: ["mridangam", "violin", "tanpura"],
      texture: "drone+lead+percussion",
    },
    sections: [
      {
        id: "p1",
        type: "pallavi",
        target_seconds: 30,
        voice_id: "indic_te_male",
        script: "telugu",
        language: "te",
      },
      {
        id: "a1",
        type: "anupallavi",
        target_seconds: 30,
        voice_id: "indic_te_male",
        script: "telugu",
        language: "te",
      },
      {
        id: "c1",
        type: "charanam",
        target_seconds: 30,
        voice_id: "indic_te_male",
        script: "telugu",
        language: "te",
      },
    ],
    metadata: { genre: "keerthana" },
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
  SANSKRIT_SHLOKA,
  BENGALI_RABINDRASANGEET,
  TELUGU_KEERTHANA,
  TAGORE_SET,
  BOLLYWOOD_BALLAD,
  TAMIL_FOLK,
  WESTERN_POP,
];

export function findPreset(id: string): StylePreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
