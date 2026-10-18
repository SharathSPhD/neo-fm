import { describe, expect, it } from "vitest";

import { normalizeLanguage, passesAdmission, passesInstrumentalAdmission, pickVocab, tagsFromDocument } from "../lib/pool/tags";

describe("pool tags", () => {
  it("normalizes language names and codes, rejects unknown", () => {
    expect(normalizeLanguage("Kannada")).toBe("kn");
    expect(normalizeLanguage("ta")).toBe("ta");
    expect(normalizeLanguage("klingon")).toBeNull();
  });
  it("keeps only closed-vocabulary values, once", () => {
    expect(pickVocab(["Festive", "festive", "grumpy"], ["festive", "calm"])).toEqual(["festive"]);
  });
  it("reads genre, tempo and prompt hints from a SongDocument", () => {
    const t = tagsFromDocument({
      language: "kn", style_family: "kannada-light-classical", tempo_bpm: 88,
      metadata: { prompt: "A short Kannada bhavageete about the first monsoon rain" },
      sections: [{ tags: ["genre:bhavageete", "tempo:mid-tempo"] }],
    });
    expect(t).toMatchObject({ language: "kn", genre: "bhavageete", raga: null, tempo_bpm: 88 });
    expect(t?.theme).toContain("monsoon");
    expect(t?.mood).toContain("calm");
  });
  it("returns null for a language the pool does not know", () => {
    expect(tagsFromDocument({ language: "xx" })).toBeNull();
  });
  it("admits only a pass at U >= 80", () => {
    expect(passesAdmission({ unorderedPct: 80, verdict: "pass" })).toBe(true);
    expect(passesAdmission({ unorderedPct: 79, verdict: "pass" })).toBe(false);
    expect(passesAdmission({ unorderedPct: 95, verdict: "review" })).toBe(false);
    expect(passesAdmission({ unorderedPct: null, verdict: null })).toBe(false);
  });
  it("admits an instrumental only when the audio check found no voice", () => {
    expect(normalizeLanguage("zxx")).toBe("zxx");
    expect(passesInstrumentalAdmission(true)).toBe(true);
    expect(passesInstrumentalAdmission(false)).toBe(false);
    expect(passesInstrumentalAdmission(null)).toBe(false);
  });
});
