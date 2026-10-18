import { describe, expect, it } from "vitest";

import { cityFromHeader, hostLang, hostLine } from "../lib/station/host";

describe("hostLine", () => {
  it("greets by daypart and names the city", () => {
    expect(hostLine({ hour: 18, language: "en", city: "Bengaluru", seed: "a" })).toMatch(/^Good evening, Bengaluru\. /);
    expect(hostLine({ hour: 9, language: "en", seed: "a" })).toMatch(/^Good morning\. /);
  });
  it("always says the music is AI-made, in every language", () => {
    for (const l of ["en", "hi", "ta", "te", "kn", "bn"]) {
      for (const seed of ["a", "b", "c", "d"]) expect(hostLine({ hour: 20, language: l, seed })).toMatch(/AI|एआई/);
    }
  });
  it("uses the track language and falls back to English", () => {
    expect(hostLine({ hour: 9, language: "hi", seed: "a" })).toContain("सुप्रभात");
    expect(hostLang("hinglish")).toBe("en");
    expect(hostLang(null)).toBe("en");
  });
  it("varies wording by seed but is stable for a seed", () => {
    const lines = new Set(["a", "b", "c", "d", "e", "f"].map((s) => hostLine({ hour: 9, language: "en", seed: s })));
    expect(lines.size).toBe(2);
    expect(hostLine({ hour: 9, language: "en", seed: "a" })).toBe(hostLine({ hour: 9, language: "en", seed: "a" }));
  });
});

describe("cityFromHeader", () => {
  it("decodes plain place names", () => {
    expect(cityFromHeader("Bengaluru")).toBe("Bengaluru");
    expect(cityFromHeader("Navi%20Mumbai")).toBe("Navi Mumbai");
    expect(cityFromHeader("%E0%AE%9A%E0%AF%86%E0%AE%A9%E0%AF%8D%E0%AE%A9%E0%AF%88")).toBe("சென்னை");
  });
  it("drops anything else", () => {
    expect(cityFromHeader(null)).toBeNull();
    expect(cityFromHeader("<script>")).toBeNull();
    expect(cityFromHeader("x".repeat(60))).toBeNull();
    expect(cityFromHeader("%E0%A4%A")).toBeNull();
  });
});
