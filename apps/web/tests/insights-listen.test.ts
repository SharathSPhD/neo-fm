import { describe, expect, it } from "vitest";
import { languageLabel, optedOutOfTracking, primaryLanguage } from "../lib/insights/listen";

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

describe("primaryLanguage", () => {
  it("keeps only the primary subtag of the first entry", () => {
    expect(primaryLanguage("hi-IN,hi;q=0.9,en;q=0.8")).toBe("hi");
    expect(primaryLanguage("TA")).toBe("ta");
    expect(primaryLanguage("kn-IN")).toBe("kn");
  });
  it("rejects anything that is not a plain language code", () => {
    for (const x of [null, undefined, "", "*", "x-private", "en_US-evil;drop", "1234", "a"]) expect(primaryLanguage(x)).toBeNull();
  });
});

describe("optedOutOfTracking", () => {
  it("honours GPC and DNT", () => {
    expect(optedOutOfTracking(h({ "sec-gpc": "1" }))).toBe(true);
    expect(optedOutOfTracking(h({ dnt: "1" }))).toBe(true);
    expect(optedOutOfTracking(h({ dnt: "0" }))).toBe(false);
    expect(optedOutOfTracking(h({}))).toBe(false);
  });
});

describe("languageLabel", () => {
  it("names a language and falls back to the code", () => {
    expect(languageLabel("hi")).toBe("Hindi");
    expect(languageLabel("zz-bad-code-!")).toBe("zz-bad-code-!");
  });
});
