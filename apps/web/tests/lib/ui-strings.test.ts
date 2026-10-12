import { describe, expect, it } from "vitest";

import { EXAMPLE_IDEAS, GUIDE_LANGS } from "@/lib/first-run/examples";
import { MOOD_SCALES, moodPhrase } from "@/lib/audio/mood-preview";
import { UI_LANGS, UI_STRINGS, translate } from "@/lib/i18n/ui-strings";

describe("ui strings", () => {
  const keys = Object.keys(UI_STRINGS.en);
  it.each(UI_LANGS)("%s has every key, non-empty", (lang) => {
    expect(Object.keys(UI_STRINGS[lang]).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      expect(UI_STRINGS[lang][k as keyof typeof UI_STRINGS.en].trim()).not.toBe("");
    }
  });
  it("non-English locales actually differ from English", () => {
    for (const lang of UI_LANGS.filter((l) => l !== "en")) {
      expect(translate(lang, "guide.title")).not.toBe(translate("en", "guide.title"));
    }
  });
});

describe("first-run content", () => {
  it("has three examples per guide language within the prompt cap", () => {
    for (const l of GUIDE_LANGS) {
      expect(EXAMPLE_IDEAS[l]).toHaveLength(3);
      for (const p of EXAMPLE_IDEAS[l]) expect(p.length).toBeLessThanOrEqual(500);
    }
  });
  it("mood phrase is audible and in range for every language", () => {
    for (const l of GUIDE_LANGS) {
      expect(MOOD_SCALES[l].length).toBeGreaterThan(4);
      const phrase = moodPhrase(l);
      expect(phrase.length).toBeGreaterThan(5);
      for (const n of phrase) {
        expect(n.freq).toBeGreaterThan(100);
        expect(n.freq).toBeLessThan(800);
      }
    }
  });
});
