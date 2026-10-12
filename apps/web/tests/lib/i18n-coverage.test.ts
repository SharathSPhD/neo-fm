import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TRANSLATION_STATUS,
  UI_LANGS,
  UI_STRINGS,
  parseAcceptLanguage,
  translate,
} from "@/lib/i18n/ui-strings";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "components", "lib"];
// Locale files define the keys; scanning them would make every key look "used".
const SKIP = /[\\/]lib[\\/]i18n[\\/]locales[\\/]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !SKIP.test(p)) out.push(p);
  }
  return out;
}

const keys = Object.keys(UI_STRINGS.en);
const keySet = new Set(keys);
const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const source = files.map((f) => readFileSync(f, "utf8")).join("\n");

// Anything shaped like a dotted i18n key inside a string literal.
// File names such as "lyrics.md" are not keys.
const literals = new Set(
  [...source.matchAll(/["'`]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)["'`]/g)]
    .map((m) => m[1] as string)
    .filter((l) => !/\.(md|json|png|svg|ts|tsx|js|css|mp3|wav)$/.test(l)),
);
const namespaces = new Set(keys.map((k) => k.split(".")[0]));

const placeholders = (s: string) => [...s.matchAll(/\{\w+\}|\[\[|\]\]/g)].map((m) => m[0]).sort();

describe("ui locale coverage", () => {
  it.each(UI_LANGS)("%s defines every key with a non-empty value", (lang) => {
    expect(Object.keys(UI_STRINGS[lang]).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      expect(UI_STRINGS[lang][k as keyof typeof UI_STRINGS.en].trim(), `${lang}:${k}`).not.toBe("");
    }
  });

  it.each(UI_LANGS)("%s keeps {placeholders} and [[markers]] identical to English", (lang) => {
    for (const k of keys) {
      expect(placeholders(UI_STRINGS[lang][k as keyof typeof UI_STRINGS.en]), `${lang}:${k}`).toEqual(
        placeholders(UI_STRINGS.en[k as keyof typeof UI_STRINGS.en]),
      );
    }
  });

  it("every key used in code is defined", () => {
    const missing = [...literals].filter((l) => namespaces.has(l.split(".")[0]) && !keySet.has(l));
    expect(missing).toEqual([]);
  });

  it("every defined key is used somewhere", () => {
    const unused = keys.filter((k) => !literals.has(k));
    expect(unused).toEqual([]);
  });

  it("every locale carries a translation status; non-English are pending review", () => {
    for (const lang of UI_LANGS) {
      expect(TRANSLATION_STATUS[lang]).toBeDefined();
      if (lang !== "en") expect(TRANSLATION_STATUS[lang]).toBe("pending-review");
    }
    expect(TRANSLATION_STATUS.en).toBe("source");
  });
});

describe("translate", () => {
  it("fills {vars}", () => {
    expect(translate("en", "common.page", { n: 3 })).toBe("Page 3");
  });
});

describe("parseAcceptLanguage", () => {
  it("picks the supported tag with the highest q", () => {
    expect(parseAcceptLanguage("fr;q=0.9, ta;q=0.8, hi;q=0.7")).toBe("ta");
    expect(parseAcceptLanguage("hi;q=0.4, kn;q=0.9")).toBe("kn");
  });
  it("maps regional tags to the base language", () => {
    expect(parseAcceptLanguage("bn-IN,en;q=0.5")).toBe("bn");
    expect(parseAcceptLanguage("te-IN")).toBe("te");
  });
  it("falls through to English for unsupported or missing headers", () => {
    expect(parseAcceptLanguage("fr-FR,de;q=0.8")).toBe("en");
    expect(parseAcceptLanguage("")).toBe("en");
    expect(parseAcceptLanguage(null)).toBe("en");
  });
});
