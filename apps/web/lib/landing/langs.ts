/** Client-safe landing constants and types (no server-only imports). */
import type { UiLang } from "@/lib/i18n/ui-strings";

export type HeroLang = Exclude<UiLang, "en">;

/** Display order matches the hero chips; `name` is the English name, `endonym` the language in its own script. */
export const HERO_LANGS: readonly { code: HeroLang; name: string; endonym: string }[] = [
  { code: "kn", name: "Kannada", endonym: "ಕನ್ನಡ" },
  { code: "ta", name: "Tamil", endonym: "தமிழ்" },
  { code: "te", name: "Telugu", endonym: "తెలుగు" },
  { code: "hi", name: "Hindi", endonym: "हिन्दी" },
  { code: "bn", name: "Bengali", endonym: "বাংলা" },
];

export interface LanguageSample {
  code: HeroLang;
  /** Set when a public, playable community song exists for this language. */
  song: { publicId: string; title: string; lines: string[] } | null;
  /** Starter idea written in the language's own script (always present). */
  idea: string;
}
