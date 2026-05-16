/**
 * @neo-fm/g2p — minimal-pair regression suite.
 *
 * Each minimal-pair JSON enumerates Devanagari / Kannada / Tamil
 * surface forms with the exact phoneme stream we expect. Tests must
 * pass at 100% — these are the cases the v1 pipeline got audibly
 * wrong, so any regression here is a singing-quality regression.
 */
import { describe, expect, it } from "vitest";

import hiSchwa from "./minimal-pairs/hi-schwa.json";
import hiNasal from "./minimal-pairs/hi-nasal.json";
import knSyll from "./minimal-pairs/kn-syllables.json";
import taCanon from "./minimal-pairs/ta-canonical.json";

import {
  inferScript,
  phonemize,
  phonemesForSection,
  type G2PResult,
  type Language,
  type Script,
} from "../src/index.js";

interface MinimalPairCase {
  name: string;
  text: string;
  language: Language;
  script: Script;
  phonemes: string[];
}

function runFixture(fixture: { description: string; cases: MinimalPairCase[] }) {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const result = phonemize({
        text: c.text,
        language: c.language,
        script: c.script,
      });
      // Whitespace tokens are bookkeeping; assert on content tokens only.
      const phonemes = result.phonemes.filter((p) => p !== " ");
      expect(phonemes).toEqual(c.phonemes);
    });
  }
}

describe("hi schwa-deletion minimal pairs", () => {
  runFixture(hiSchwa);
});

describe("hi nasal-assimilation minimal pairs", () => {
  runFixture(hiNasal);
});

describe("kn syllabification minimal pairs", () => {
  runFixture(knSyll);
});

describe("ta canonicalisation minimal pairs", () => {
  runFixture(taCanon);
});

describe("inferScript", () => {
  it("infers devanagari from a hindi-script string", () => {
    expect(inferScript("नमस्ते")).toBe("devanagari");
  });
  it("infers kannada", () => {
    expect(inferScript("ಕನ್ನಡ")).toBe("kannada");
  });
  it("infers tamil", () => {
    expect(inferScript("தமிழ்")).toBe("tamil");
  });
  it("defaults to latin", () => {
    expect(inferScript("namaskaar")).toBe("latin");
  });
  it("ignores ASCII whitespace before deciding", () => {
    expect(inferScript("  ಕನ್ನಡ")).toBe("kannada");
  });
});

describe("phonemize english passthrough", () => {
  it("returns lower-cased words", () => {
    const r: G2PResult = phonemize({ text: "Hello World", language: "en" });
    expect(r.phonemes.filter((p) => p !== " ")).toEqual(["hello", "world"]);
    expect(r.language).toBe("en");
  });

  it("routes Indic-phonotactics-heavy roman text through Hindi", () => {
    // Eight clear Hindi hint hits across 3 words → density 2.7 → route.
    const r: G2PResult = phonemize({
      text: "kaaghaz aakhir dhanyavaad",
      language: "en",
    });
    // We expect the Hinglish path, not the English passthrough.
    expect(r.rule_traces.some((t) => t.startsWith("en:hinglish-route"))).toBe(
      true,
    );
  });
});

describe("phonemesForSection", () => {
  it("returns [] for empty / undefined lyrics", () => {
    expect(phonemesForSection({ language: "hi" })).toEqual([]);
    expect(phonemesForSection({ language: "hi", lyrics: "" })).toEqual([]);
    expect(phonemesForSection({ language: "hi", lyrics: "   " })).toEqual([]);
  });

  it("prefers transliteration over lyrics when both are set", () => {
    const out = phonemesForSection({
      language: "hi",
      lyrics: "नमस्कार",
      transliteration: "namaskaar",
    });
    // Transliteration → latin path; should not contain Devanagari-only
    // tokens like 'sh' or 'kh' but should contain 'aa'.
    expect(out).toContain("aa");
  });

  it("emits a phoneme per akshara onset for Devanagari input", () => {
    const out = phonemesForSection({ language: "hi", lyrics: "कमल" });
    // Should match the schwa-delete case from the fixture.
    expect(out).toEqual(["k", "a", "m", "a", "l"]);
  });

  it("never includes whitespace tokens", () => {
    const out = phonemesForSection({ language: "hi", lyrics: "नमस्कार राम" });
    expect(out.includes(" ")).toBe(false);
  });
});
