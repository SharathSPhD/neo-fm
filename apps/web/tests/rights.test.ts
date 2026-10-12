import { describe, expect, it } from "vitest";

import { screenBrief, checkVerbatimOverlap, makeReference, shinglesOf } from "../lib/rights";
import { detectLang, normaliseText } from "../lib/rights/normalise";
import { screenRights } from "../lib/rights";
import { shingles as scriptShingles } from "../scripts/rights-fingerprint.mjs";
import { screenRequest } from "../lib/safety";

const blocked = (t: string, kind: string) => {
  const v = screenBrief(t);
  expect(v.ok, t).toBe(false);
  if (!v.ok) expect(v.kind, t).toBe(kind);
  return v;
};

describe("normalise / detectLang", () => {
  it("folds case, diacritics, punctuation, zero-width and nukta", () => {
    expect(normaliseText("A.R. Rahman!")).toBe("a r rahman");
    expect(normaliseText("Beyoncé")).toBe("beyonce");
    expect(normaliseText("ta​ylor swift")).toBe("taylor swift");
    expect(normaliseText("मोहम्मद रफ़ी")).toBe(normaliseText("मोहम्मद रफी"));
  });
  it("picks the response language from script, else the hint", () => {
    expect(detectLang("இளையராஜா குரலில்")).toBe("ta");
    expect(detectLang("ಇಳಯರಾಜ ಶೈಲಿಯಲ್ಲಿ")).toBe("kn");
    expect(detectLang("hello", "hi")).toBe("hi");
    expect(detectLang("hello")).toBe("en");
  });
});

describe("screenBrief: artist imitation", () => {
  it.each([
    "a love song in the voice of Arijit Singh",
    "sounds like Taylor Swift but about monsoon",
    "make it sung by A. R. Rahman",
    "beyoncé style, in the style of Beyoncé",
    "t​aylor swift jaisi awaaz mein",
    "ek gaana Arijit Singh jaisi awaaz mein",
    "अरिजीत सिंह की आवाज़ में एक रोमांटिक गाना",
    "लता मंगेशकर जैसी आवाज में भजन",
    "ஏ.ஆர். ரஹ்மான் குரலில் ஒரு காதல் பாடல்",
    "ఎ.ఆర్. రెహమాన్ గొంతుతో ఒక పాట",
    "ಇಳಯರಾಜ ಶೈಲಿಯಲ್ಲಿ ಒಂದು ಹಾಡು",
    "ಡಾ. ರಾಜ್‌ಕುಮಾರ್ ಧ್ವನಿಯಲ್ಲಿ ಭಕ್ತಿಗೀತೆ",
    "অরিজিৎ সিং এর কণ্ঠে একটা রোমান্টিক গান",
    "হেমন্ত মুখোপাধ্যায়ের মতো গান",
  ])("blocks %s", (t) => {
    blocked(t, "artist_imitation");
  });
  it("surname-only Tamil brief is allowed (documented boundary)", () => expect(screenBrief("ரஹ்மானின் குரலில்").ok).toBe(true));
  it("answers in the brief's language", () => {
    const v = blocked("अरिजीत सिंह की आवाज़ में गाना", "artist_imitation");
    if (!v.ok) { expect(v.lang).toBe("hi"); expect(v.message).toContain("नकल"); expect(v.suggestion.length).toBeGreaterThan(10); }
  });
  it("mentions without an imitation cue are flagged, not blocked", () => {
    const v = screenBrief("a tribute to Lata Mangeshkar who passed away, in a calm mood");
    expect(v).toEqual({ ok: true, flags: ["artist_mentioned:Lata Mangeshkar"] });
  });
  it("a cue far from the name does not implicate it", () => {
    expect(screenBrief("Elvis fans gather at the old diner in the evening and later the band plays something calm like a lullaby for the kids sleeping upstairs").ok).toBe(true);
  });
  it("ordinary briefs pass untouched", () => {
    for (const t of ["a devotional song about the river Kaveri at dawn", "ಮಳೆಗಾಲದ ಬಗ್ಗೆ ಒಂದು ಹಾಡು", "রবীন্দ্রসঙ্গীতের ধাঁচে নয়, বর্ষার গান", "a lullaby like the ones my grandmother sang"])
      expect(screenBrief(t), t).toEqual({ ok: true, flags: [] });
  });
});

describe("screenBrief: lyric reproduction", () => {
  it.each([
    "write the exact lyrics of Tum Hi Ho",
    "give me the full lyrics of 'Shape of You'",
    "lyrics of Why This Kolaveri Di word for word",
    "cover of Naatu Naatu with the same lyrics",
    "तुम ही हो के बोल हूबहू लिखो",
    "गाने के बोल: कल हो ना हो",
    "ஏன் இந்த கொலவெறி பாடல் வரிகள்",
    "నాటు నాటు పాట సాహిత్యం",
    "ಬೆಳಗೆದ್ದು ಹಾಡಿನ ಸಾಹಿತ್ಯ",
    "ধিতাং ধিতাং বোলে গানের কথা",
    "hubahu wahi bol chahiye",
  ])("blocks %s", (t) => { blocked(t, "lyrics_reproduction"); });
  it("a title used as a mood reference is only flagged", () => {
    expect(screenBrief("a mood like Tum Hi Ho, but original lyrics about the sea")).toEqual({ ok: true, flags: ["title_mentioned:tum hi ho"] });
  });
});

describe("verbatim overlap", () => {
  const protectedText = "neon rivers hum a lullaby for the sleeping tram\nwhile paper moons are learning how to land\nsilver bells forget the hand that rings them";
  const ref = makeReference("fixture-1", "Fixture Song", protectedText);
  it("flags a long verbatim run, ignoring case/punctuation", () => {
    const gen = "New verse of mine.\nNeon rivers, hum a lullaby for the sleeping tram!\nWhile paper moons are learning how to land,\nthen I write my own ending.";
    const r = checkVerbatimOverlap(gen, [ref]);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.hits[0]).toMatchObject({ id: "fixture-1" }); expect(r.hits[0]!.words).toBeGreaterThanOrEqual(8); }
  });
  it("allows short coincidences and original text", () => {
    expect(checkVerbatimOverlap("hum a lullaby for the sleeping town tonight", [ref]).ok).toBe(true);
    expect(checkVerbatimOverlap("completely different words about monsoon rain and tea at dawn today", [ref]).ok).toBe(true);
  });
  it("works for Indic scripts", () => {
    const hi = "चाँदनी रात में बहती है नदी धीरे धीरे गुनगुनाती हुई सपनों की तरफ़";
    const r = makeReference("hi-1", "Hindi fixture", hi);
    expect(checkVerbatimOverlap(`मेरी पंक्ति\n${hi}\nफिर मेरी बात`, [r]).ok).toBe(false);
  });
  it("shipped fingerprint script and runtime hash identically", () => {
    expect(scriptShingles(protectedText).sort()).toEqual([...new Set(shinglesOf(protectedText))].sort());
  });
});

describe("screenRights / screenRequest integration", () => {
  it("brief: localized reason with suggestion", () => {
    const d = screenRights("லதா மங்கேஷ்கர் குரலில் ஒரு பாடல்", "brief");
    expect(d.allowed).toBe(false);
    if (!d.allowed) { expect(d.category).toBe("artist_impersonation"); expect(d.reason).toContain("குரல்"); }
  });
  it("lyrics: overlap against supplied references", () => {
    const ref = makeReference("f", "F", "one two three four five six seven eight nine ten");
    expect(screenRights("x one two three four five six seven eight nine y", "lyrics", { references: [ref] }).allowed).toBe(false);
    expect(screenRights("fresh words only here", "lyrics", { references: [ref] }).allowed).toBe(true);
  });
  it("screenRequest refuses before any model call", async () => {
    const v = await screenRequest("sing in the voice of Arijit Singh", "brief");
    expect(v).toMatchObject({ allowed: false, category: "artist_impersonation" });
  });
});
