import { describe, expect, it } from "vitest";

import {
  findRaga,
  INSTRUMENT_CATALOGUE,
  RAGA_CATALOGUE,
  TALA_CATALOGUE,
  ragasForStyle,
  talasForSystem,
} from "./raga-catalogue.js";

describe("raga catalogue", () => {
  it("ships exactly 12 ragas with unique names", () => {
    expect(RAGA_CATALOGUE.length).toBe(12);
    const names = new Set(RAGA_CATALOGUE.map((r) => r.name));
    expect(names.size).toBe(12);
  });

  it("covers both Carnatic and Hindustani systems", () => {
    const carnatic = RAGA_CATALOGUE.filter((r) => r.system === "carnatic");
    const hindustani = RAGA_CATALOGUE.filter((r) => r.system === "hindustani");
    expect(carnatic.length).toBeGreaterThanOrEqual(5);
    expect(hindustani.length).toBeGreaterThanOrEqual(5);
  });

  it("findRaga is case-insensitive and trims whitespace", () => {
    expect(findRaga(" YAMAN ")?.name).toBe("yaman");
    expect(findRaga("notARealRaga")).toBeNull();
  });

  it("ragasForStyle returns Carnatic ragas for carnatic / shloka / keerthana", () => {
    for (const style of [
      "carnatic",
      "telugu-keerthana",
      "sanskrit-shloka",
    ] as const) {
      const list = ragasForStyle(style);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((r) => r.system === "carnatic")).toBe(true);
    }
  });

  it("ragasForStyle returns Hindustani ragas for hindustani / rabindrasangeet", () => {
    for (const style of ["hindustani", "bengali-rabindrasangeet"] as const) {
      const list = ragasForStyle(style);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((r) => r.system === "hindustani")).toBe(true);
    }
  });

  it("ragasForStyle returns bhavageete-friendly + Carnatic for kannada-light-classical", () => {
    const list = ragasForStyle("kannada-light-classical");
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((r) => r.bhavageeteFriendly || r.system === "carnatic")).toBe(
      true,
    );
  });

  it("ragasForStyle returns an empty list for styles without raga support", () => {
    expect(ragasForStyle("western")).toEqual([]);
    expect(ragasForStyle("bollywood-ballad")).toEqual([]);
    expect(ragasForStyle("kannada-folk")).toEqual([]);
    expect(ragasForStyle("tamil-folk")).toEqual([]);
  });
});

describe("tala catalogue", () => {
  it("ships 8 talas (4 Carnatic + 4 Hindustani)", () => {
    expect(TALA_CATALOGUE.length).toBe(8);
    expect(TALA_CATALOGUE.filter((t) => t.family === "carnatic").length).toBe(4);
    expect(TALA_CATALOGUE.filter((t) => t.family === "hindustani").length).toBe(4);
  });

  it("talasForSystem filters by family; light-classical maps to Carnatic", () => {
    expect(talasForSystem("carnatic").every((t) => t.family === "carnatic")).toBe(
      true,
    );
    expect(talasForSystem("hindustani").every((t) => t.family === "hindustani")).toBe(
      true,
    );
    expect(talasForSystem("light-classical").every((t) => t.family === "carnatic")).toBe(
      true,
    );
    // Folk / undefined fall through and return everything.
    expect(talasForSystem(undefined).length).toBe(8);
    expect(talasForSystem("folk").length).toBe(8);
  });
});

describe("instrument catalogue", () => {
  it("covers every v1.4 style family", () => {
    const required = [
      "western",
      "carnatic",
      "hindustani",
      "kannada-folk",
      "kannada-light-classical",
      "tamil-folk",
      "bollywood-ballad",
      "bengali-rabindrasangeet",
      "telugu-keerthana",
      "sanskrit-shloka",
    ];
    for (const style of required) {
      expect(INSTRUMENT_CATALOGUE[style]).toBeDefined();
      expect(INSTRUMENT_CATALOGUE[style]!.length).toBeGreaterThan(0);
    }
  });
});
