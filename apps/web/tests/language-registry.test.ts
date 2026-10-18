import { describe, expect, it } from "vitest";

import { CreateSongRequestSchema } from "../lib/api/song-schemas";
import { dictionHints } from "../lib/diction";
import { singingScript } from "../lib/diction/romanize";
import {
  DEFAULT_MIN_POOL,
  EXPANSION_LANGUAGES,
  enabledExpansionLanguages,
  enabledWave,
  isEnabledLanguage,
  minPool,
  stationChipLanguages,
} from "../lib/languages/registry";
import { normalizeLanguage, POOL_LANGUAGES } from "../lib/pool/tags";
import { hostLine } from "../lib/station/host";
import { parsePrefs } from "../lib/station/prefs";

describe("language registry", () => {
  it("is off by default and for anything that is not a wave number", () => {
    for (const raw of [undefined, null, "", "0", "4", "x", "-1", "1.5"]) {
      expect(enabledWave(raw)).toBe(0);
      expect(enabledExpansionLanguages(raw)).toHaveLength(0);
    }
  });

  it("enables waves cumulatively", () => {
    expect(enabledExpansionLanguages("1").map((l) => l.code)).toEqual(["mr", "pa", "ml", "gu"]);
    expect(enabledExpansionLanguages("2").map((l) => l.code)).toEqual(["mr", "pa", "ml", "gu", "or", "ur", "bho"]);
    expect(enabledExpansionLanguages("3")).toHaveLength(EXPANSION_LANGUAGES.length);
  });

  it("always allows the launch languages and gates the expansion ones", () => {
    for (const c of ["en", "hi", "ta", "te", "kn", "bn", "sa"]) expect(isEnabledLanguage(c, undefined)).toBe(true);
    expect(isEnabledLanguage("mr", undefined)).toBe(false);
    expect(isEnabledLanguage("mr", "1")).toBe(true);
    expect(isEnabledLanguage("ur", "1")).toBe(false);
    expect(isEnabledLanguage("ur", "2")).toBe(true);
  });

  it("offers a station chip only when the wave is on and the pool is deep enough", () => {
    const counts = { mr: 30, pa: 24, gu: 25, ur: 99 };
    expect(stationChipLanguages(undefined, undefined, counts)).toEqual([]);
    expect(stationChipLanguages("1", undefined, counts).map((l) => l.code)).toEqual(["mr", "gu"]);
    expect(stationChipLanguages("1", "10", counts).map((l) => l.code)).toEqual(["mr", "pa", "gu"]);
    expect(stationChipLanguages("2", undefined, counts).map((l) => l.code)).toEqual(["mr", "gu", "ur"]);
  });

  it("falls back to the council's pool minimum for bad values", () => {
    expect(minPool(undefined)).toBe(DEFAULT_MIN_POOL);
    expect(minPool("abc")).toBe(DEFAULT_MIN_POOL);
    expect(minPool("-3")).toBe(DEFAULT_MIN_POOL);
    expect(minPool("12")).toBe(12);
  });
});

describe("expansion languages elsewhere", () => {
  it("pool tags accept codes and names", () => {
    for (const l of EXPANSION_LANGUAGES) {
      expect(POOL_LANGUAGES).toContain(l.code);
      expect(normalizeLanguage(l.code)).toBe(l.code);
      expect(normalizeLanguage(l.name)).toBe(l.code);
    }
    expect(normalizeLanguage("Oriya")).toBe("or");
  });

  it("every expansion language has a host line in its own script, with the AI label", () => {
    for (const l of EXPANSION_LANGUAGES) {
      const line = hostLine({ hour: 9, language: l.code, seed: "t1" });
      expect(line.length).toBeGreaterThan(10);
      // Not the English fallback.
      expect(line).not.toMatch(/^Good /);
    }
  });

  it("pronunciation hints resolve from the code for expansion languages only", () => {
    for (const l of EXPANSION_LANGUAGES) expect(dictionHints(l.code), l.code).not.toBe("");
    // Launch languages keep today's behaviour (hints by name, empty by code) until the eval gate says otherwise.
    expect(dictionHints("kn")).toBe("");
    expect(dictionHints("Kannada")).not.toBe("");
  });

  it("saved station preferences keep an expansion language so the player can decide", () => {
    expect(parsePrefs(JSON.stringify({ lang: "mr", moods: [] }))?.lang).toBe("mr");
    expect(parsePrefs(JSON.stringify({ lang: "xx", moods: [] }))?.lang).toBe("");
  });
});

describe("song creation gate", () => {
  const body = { prompt: "a song", language: "mr", style_family: "western", target_duration_seconds: 30 };
  const run = (waves: string | undefined) => {
    const prev = process.env.LANG_WAVES;
    if (waves === undefined) delete process.env.LANG_WAVES;
    else process.env.LANG_WAVES = waves;
    try {
      return CreateSongRequestSchema.safeParse(body);
    } finally {
      if (prev === undefined) delete process.env.LANG_WAVES;
      else process.env.LANG_WAVES = prev;
    }
  };

  it("rejects an expansion language until its wave is enabled", () => {
    const off = run(undefined);
    expect(off.success).toBe(false);
    expect(JSON.stringify(off.success ? "" : off.error.issues)).toContain("not available yet");
    expect(run("1").success).toBe(true);
  });

  it("never blocks a launch language", () => {
    delete process.env.LANG_WAVES;
    expect(CreateSongRequestSchema.safeParse({ ...body, language: "ta" }).success).toBe(true);
  });
});

describe("singing script for expansion scripts", () => {
  // Evidence for the plan's claim that the romanised singing script needs no new code for these scripts.
  const samples: Record<string, string> = {
    mr: "तुझ्या सोबत चालताना",
    pa: "ਤੇਰੇ ਨਾਲ ਚੱਲਦੇ ਹਾਂ",
    gu: "તારી સાથે ચાલતા",
    ml: "നിന്നോടൊപ്പം നടക്കുമ്പോൾ",
    or: "ତୁମ ସାଙ୍ଗରେ ଚାଲିଲା",
    as: "তোমাৰ লগত খোজ দিওঁতে",
  };
  for (const [code, line] of Object.entries(samples)) {
    it(`${code}: native line is followed by a Latin romanisation`, () => {
      const out = singingScript(`[Verse]\n${line}`);
      expect(out.romanized).toBe(true);
      const lines = out.text.split("\n");
      expect(lines[1]).toBe(line);
      expect(lines[2]).toMatch(/^\([A-Za-z~^.\-' ]+\)$/);
      // No Indic character may survive into the roman line.
      expect(lines[2]).not.toMatch(/[\u0900-\u0dff]/);
    });
  }

  it("ur: Arabic-script lines are left as they are (no scheme yet)", () => {
    expect(singingScript("تیرے ساتھ چلتے ہیں").romanized).toBe(false);
  });
});
