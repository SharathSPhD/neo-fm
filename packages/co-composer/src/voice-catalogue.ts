/**
 * v1.4 Sprint 5 — voice catalogue mirror.
 *
 * Hand-mirrored copy of
 * `services/vocal-synth/app/voice_catalogue.json`. The voice picker UI
 * on `/songs/new` reads from this module so the web build doesn't need
 * to fetch the JSON at runtime, and the unit tests assert that this
 * TS list and the Python catalogue stay byte-aligned on the
 * `voice_id` set.
 *
 * Keep this file append-only: SongDocuments persisted with an older
 * `voice_id` must keep resolving.
 */
import type { Language } from "@neo-fm/song-doc";

/** Subset of `Language` we ship a persona for today. */
export type VoiceLanguage = Extract<
  Language,
  "en" | "hi" | "kn" | "ta" | "te" | "bn" | "sa"
>;

export type VoiceGender = "male" | "female" | "androgynous";

/**
 * Public catalogue entry. We deliberately do **not** export the
 * `prompt` field — the prompt is a server-side concern and we don't
 * want users to think of it as a tunable knob in the UI.
 */
export interface VoiceCatalogueEntry {
  readonly voice_id: string;
  readonly language: VoiceLanguage;
  readonly gender: VoiceGender;
  readonly persona: string;
  readonly label: string;
  /** `samples/<voice_id>.wav` under the public `voice-samples` bucket. */
  readonly preview_path: string;
}

export const VOICE_CATALOGUE: readonly VoiceCatalogueEntry[] = [
  {
    voice_id: "indic_hi_male_broadcast",
    language: "hi",
    gender: "male",
    persona: "broadcast-clear",
    label: "Hindi · Broadcast male",
    preview_path: "samples/indic_hi_male_broadcast.wav",
  },
  {
    voice_id: "indic_hi_female_lyrical",
    language: "hi",
    gender: "female",
    persona: "lyrical-warm",
    label: "Hindi · Lyrical female",
    preview_path: "samples/indic_hi_female_lyrical.wav",
  },
  {
    voice_id: "indic_kn_male_warm",
    language: "kn",
    gender: "male",
    persona: "warm-storyteller",
    label: "Kannada · Warm storyteller",
    preview_path: "samples/indic_kn_male_warm.wav",
  },
  {
    voice_id: "indic_kn_female_bhajan",
    language: "kn",
    gender: "female",
    persona: "bhajan",
    label: "Kannada · Bhajan female",
    preview_path: "samples/indic_kn_female_bhajan.wav",
  },
  {
    voice_id: "indic_ta_male_nadaswaram",
    language: "ta",
    gender: "male",
    persona: "classical-paired",
    label: "Tamil · Classical-paired male",
    preview_path: "samples/indic_ta_male_nadaswaram.wav",
  },
  {
    voice_id: "indic_ta_female_devotional",
    language: "ta",
    gender: "female",
    persona: "bhakti",
    label: "Tamil · Bhakti female",
    preview_path: "samples/indic_ta_female_devotional.wav",
  },
  {
    voice_id: "indic_te_male",
    language: "te",
    gender: "male",
    persona: "neutral",
    label: "Telugu · Neutral male",
    preview_path: "samples/indic_te_male.wav",
  },
  {
    voice_id: "indic_te_female",
    language: "te",
    gender: "female",
    persona: "neutral",
    label: "Telugu · Neutral female",
    preview_path: "samples/indic_te_female.wav",
  },
  {
    voice_id: "indic_bn_male_rabindra",
    language: "bn",
    gender: "male",
    persona: "rabindrasangeet",
    label: "Bengali · Rabindrasangeet male",
    preview_path: "samples/indic_bn_male_rabindra.wav",
  },
  {
    voice_id: "indic_bn_female",
    language: "bn",
    gender: "female",
    persona: "neutral",
    label: "Bengali · Neutral female",
    preview_path: "samples/indic_bn_female.wav",
  },
  {
    voice_id: "en_in_male_announcer",
    language: "en",
    gender: "male",
    persona: "indian-english-announcer",
    label: "English (IN) · Announcer male",
    preview_path: "samples/en_in_male_announcer.wav",
  },
  {
    voice_id: "en_in_female_rj",
    language: "en",
    gender: "female",
    persona: "radio-jockey",
    label: "English (IN) · Radio jockey female",
    preview_path: "samples/en_in_female_rj.wav",
  },
  {
    voice_id: "chant_sustained",
    language: "sa",
    gender: "androgynous",
    persona: "slow-sustained-chant",
    label: "Sanskrit · Sustained chant",
    preview_path: "samples/chant_sustained.wav",
  },
  {
    voice_id: "chant_devotional",
    language: "hi",
    gender: "androgynous",
    persona: "bright-devotional",
    label: "Devotional · Bright chant",
    preview_path: "samples/chant_devotional.wav",
  },
  {
    voice_id: "cinematic_baritone",
    language: "en",
    gender: "male",
    persona: "warm-narrator",
    label: "Cinematic · Baritone narrator",
    preview_path: "samples/cinematic_baritone.wav",
  },
  {
    voice_id: "cinematic_alto",
    language: "en",
    gender: "female",
    persona: "airy-alto",
    label: "Cinematic · Airy alto",
    preview_path: "samples/cinematic_alto.wav",
  },
] as const;

/** Lexicographic `voice_id` list, used by snapshot tests and routing. */
export const VOICE_IDS: readonly string[] = VOICE_CATALOGUE.map(
  (v) => v.voice_id,
)
  .slice()
  .sort();

export function findVoice(voiceId: string): VoiceCatalogueEntry | undefined {
  return VOICE_CATALOGUE.find((v) => v.voice_id === voiceId);
}

/**
 * Voices that are a good default for ``language``. We use it both for
 * the "Suggested" group in the picker and for the smart default the
 * creation canvas picks when the user switches language.
 */
export function voicesForLanguage(
  language: VoiceLanguage,
): readonly VoiceCatalogueEntry[] {
  return VOICE_CATALOGUE.filter((v) => v.language === language);
}
