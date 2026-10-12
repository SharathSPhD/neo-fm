/**
 * UI strings in the five launch languages plus English.
 *
 * `locales/en.ts` is the source of truth for keys; every other locale
 * must define every key (enforced by `tests/lib/i18n-coverage.test.ts`,
 * which also fails on keys used in code but undefined, keys defined but
 * never used, and `{placeholder}` mismatches between locales).
 *
 * Non-English translations are first-pass and marked `pending-review`
 * in TRANSLATION_STATUS until a native speaker signs them off.
 */
import { bn } from "./locales/bn";
import { en } from "./locales/en";
import { hi } from "./locales/hi";
import { kn } from "./locales/kn";
import { ta } from "./locales/ta";
import { te } from "./locales/te";

export const UI_LANGS = ["en", "hi", "ta", "te", "kn", "bn"] as const;
export type UiLang = (typeof UI_LANGS)[number];

/** Name of each language written in its own script (what the picker shows). */
export const UI_LANG_ENDONYM: Record<UiLang, string> = {
  en: "English",
  hi: "हिन्दी",
  ta: "தமிழ்",
  te: "తెలుగు",
  kn: "ಕನ್ನಡ",
  bn: "বাংলা",
};

/** Flip a locale to "reviewed" only after a native speaker has signed it off. */
export const TRANSLATION_STATUS: Record<UiLang, "source" | "pending-review" | "reviewed"> = {
  en: "source",
  hi: "pending-review",
  ta: "pending-review",
  te: "pending-review",
  kn: "pending-review",
  bn: "pending-review",
};

export type UiKey = keyof typeof en;
export type Dict = Record<UiKey, string>;

export const UI_STRINGS: Record<UiLang, Dict> = { en, hi, ta, te, kn, bn };

export const DEFAULT_UI_LANG: UiLang = "en";
export const UI_LANG_COOKIE = "neo-fm-lang";

export function isUiLang(v: unknown): v is UiLang {
  return typeof v === "string" && (UI_LANGS as readonly string[]).includes(v);
}

export type UiVars = Record<string, string | number>;

export function translate(lang: UiLang, key: UiKey, vars?: UiVars): string {
  const raw = UI_STRINGS[lang][key] ?? UI_STRINGS.en[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/**
 * Pick the best supported UI language from an Accept-Language header,
 * honouring q-values. Unsupported tags (e.g. "mr", "gu") fall through to
 * the next candidate, then to English.
 */
export function parseAcceptLanguage(header: string | null | undefined): UiLang {
  if (!header) return DEFAULT_UI_LANG;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find(Boolean);
      return { primary: tag.trim().toLowerCase().split("-")[0] ?? "", q: q ? Number(q) : 1, i };
    })
    .filter((c) => c.primary && c.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const c of ranked) if (isUiLang(c.primary)) return c.primary;
  return DEFAULT_UI_LANG;
}
