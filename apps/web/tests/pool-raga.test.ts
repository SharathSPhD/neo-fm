import { describe, expect, it } from "vitest";
import { POOL_DAYPARTS, POOL_MOODS, deriveEnergyDaypart, tagsFromDocument } from "../lib/pool/tags";
import { RAGA_CANON, normalizeRaga, ragasFor } from "../lib/pool/raga";

describe("raga canon", () => {
  it("uses the pool vocabularies", () => {
    for (const r of RAGA_CANON) {
      r.dayparts.forEach((d) => expect(POOL_DAYPARTS).toContain(d));
      r.moods.forEach((m) => expect(POOL_MOODS).toContain(m));
    }
  });

  it("normalises spellings, prefixes and aliases", () => {
    expect(normalizeRaga("Raag Yaman")).toBe("Yaman");
    expect(normalizeRaga("  yaman ")).toBe("Yaman");
    expect(normalizeRaga("Bhoop")).toBe("Bhoopali");
    expect(normalizeRaga("Malhar")).toBe("Miyan ki Malhar");
    expect(normalizeRaga("Mohanam raga")).toBe("Mohanam");
    expect(normalizeRaga("Bhairavi")).toBe("Bhairavi");
  });

  it("drops names that are not ragas", () => {
    expect(normalizeRaga("Rock")).toBeNull();
    expect(normalizeRaga("")).toBeNull();
    expect(normalizeRaga(null)).toBeNull();
  });

  it("suggests ragas by daypart and mood", () => {
    const dusk = ragasFor({ daypart: "dusk", tradition: "hindustani" }).map((r) => r.name);
    expect(dusk).toContain("Marwa");
    expect(ragasFor({ daypart: "night", mood: "calm" })[0]!.dayparts).toContain("night");
    expect(ragasFor({})).toEqual([]);
  });
});

describe("pool tags carry the raga", () => {
  it("reads the raga from the song document and the routed style from metadata.genre", () => {
    const t = tagsFromDocument({ language: "hi", style_family: "classical", raga: { name: "Raag Bhoop" }, metadata: { prompt: "evening bhajan", genre: "bhajan-hindi" }, sections: [] });
    expect(t?.raga).toBe("Bhoopali");
    expect(t?.genre).toBe("bhajan-hindi");
  });

  it("keeps a section tag ahead of the document and ignores unknown ragas", () => {
    expect(tagsFromDocument({ language: "hi", raga: { name: "Yaman" }, sections: [{ tags: ["raga:Todi"] }] })?.raga).toBe("Todi");
    expect(tagsFromDocument({ language: "hi", raga: { name: "Jazzy" } })?.raga).toBeNull();
    expect(tagsFromDocument({ language: "hi" })?.raga).toBeNull();
  });

  it("lets a known raga decide the daypart", () => {
    expect(deriveEnergyDaypart({ mood: ["joyful"], theme: [], genre: "classical", tempo_bpm: null, raga: "Malkauns" }).daypart).toEqual(["night"]);
    expect(deriveEnergyDaypart({ mood: ["joyful"], theme: [], genre: "classical", tempo_bpm: null }).daypart).not.toEqual(["night"]);
  });
});
