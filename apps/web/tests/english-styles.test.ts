import { describe, expect, it } from "vitest";
import { ENGLISH_STYLES, routeEnglishStyle } from "../lib/engine/english-styles";
import { styleOnly, styleRoutingOn } from "../lib/engine/intent";

const ctx = (prompt: string, language = "en") => ({ prompt, language, styleFamily: "western" });
const on = { ENGLISH_STYLES: "1" };

describe("english styles", () => {
  it("routes each genre word to its style", () => {
    const cases: [string, string][] = [
      ["A bright summer pop song about a holiday", "en-pop"], ["A driving rock anthem about leaving town", "en-rock"],
      ["A slow r&b song about texting an ex", "en-rnb"], ["A laid-back hip-hop track about Sunday cooking", "en-hiphop"],
      ["A country ballad about a father's truck", "en-country"], ["An indie folk lullaby for a newborn", "en-indie-folk"], ["Dance floor banger about Friday night", "en-dance"],
    ];
    for (const [p, id] of cases) expect(routeEnglishStyle(p)?.id, p).toBe(id);
  });
  it("longest keyword wins and whole words only", () => {
    expect(routeEnglishStyle("an indie folk song")?.id).toBe("en-indie-folk");
    expect(routeEnglishStyle("a poppy tune about popular opinion")).toBeUndefined();
    expect(routeEnglishStyle("a song about my day")).toBeUndefined();
  });
  it("styleOnly gives an English fragment only for en with the flag on", () => {
    const r = styleOnly(ctx("a country song about a diner"), on);
    expect(r?.genre).toBe("en-country");
    expect(r?.fragment).toMatch(/bpm/);
    expect(r?.note).toMatch(/^Style: Country\. Form: Verse 1/);
    expect(styleOnly(ctx("a country song about a diner"), {})).toBeNull();
    expect(styleOnly(ctx("a country song about a diner", "hi"), on)).toBeNull();
    expect(styleOnly(ctx("a plain song about my day"), on)).toBeNull();
  });
  it("routing is on for en under ENGLISH_STYLES, other languages need PCE_STYLES", () => {
    expect(styleRoutingOn("en", on)).toBe(true);
    expect(styleRoutingOn("hi", on)).toBe(false);
    expect(styleRoutingOn("hi", { PCE_STYLES: "1" })).toBe(true);
    expect(styleRoutingOn("en", {})).toBe(false);
  });
  it("fragments name no artist and carry tempo, instruments and vocal", () => {
    for (const s of ENGLISH_STYLES) { expect(s.lyria).toMatch(/\d+-\d+ bpm/); expect(s.lyria.toLowerCase()).toMatch(/vocal/); expect(s.forms.length).toBeGreaterThan(3); }
  });
});
