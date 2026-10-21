import { afterEach, describe, expect, it, vi } from "vitest";

import { LANGUAGE_ARTICLES } from "../../lib/seo/language-articles";
import { LANGUAGE_PAGES, activeLanguagePages, hreflangPaths, languageCodeForPath, languagePageBySlug } from "../../lib/seo/language-pages";

afterEach(() => vi.unstubAllEnvs());

describe("English language page behind ENGLISH_MAIN", () => {
  it("is absent by default, leaving the six Indian-language pages", () => {
    expect(activeLanguagePages()).toBe(LANGUAGE_PAGES);
    expect(languagePageBySlug("english")).toBeUndefined();
    expect(hreflangPaths()).not.toHaveProperty("x-default", "/ai-songs/english");
    expect(languageCodeForPath("/ai-songs/english")).toBeUndefined();
  });
  it("is listed first when on, with its explainer, and keeps / as the English hreflang", () => {
    vi.stubEnv("ENGLISH_MAIN", "1");
    expect(activeLanguagePages().map((p) => p.code)).toEqual(["en", "hi", "mr", "ta", "te", "kn", "bn"]);
    expect(languagePageBySlug("english")?.code).toBe("en");
    expect(languageCodeForPath("/ai-songs/english/how-it-works")).toBe("en");
    expect(hreflangPaths().en).toBe("/");
    expect(LANGUAGE_ARTICLES.en.sections.length).toBeGreaterThan(3);
  });
});
