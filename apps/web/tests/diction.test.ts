import { describe, expect, it } from "vitest";

import { aksharas, charErrorRate, dictionHints, lineProsody, scoreTranscript, detectScript } from "../lib/diction";

describe("script detection", () => {
  it("names the Indic scripts", () => {
    expect(detectScript("ಮಳೆ ಬಂತು")).toBe("kannada");
    expect(detectScript("மழை வந்தது")).toBe("tamil");
    expect(detectScript("బారిష్")).toBe("telugu");
    expect(detectScript("बारिश आई")).toBe("devanagari");
    expect(detectScript("বৃষ্টি")).toBe("bengali");
    expect(detectScript("rain")).toBe("latin");
  });
});

describe("akshara segmentation", () => {
  it("keeps conjuncts and vowel signs in one akshara", () => {
    // ಸ್ತ್ರೀ = one akshara (s+virama+t+virama+r + long ii)
    expect(aksharas("ಸ್ತ್ರೀ")).toHaveLength(1);
    // ಮಳೆ = ma, La+e-sign -> 2
    expect(aksharas("ಮಳೆ")).toHaveLength(2);
    // Hindi 'प्रेम' = pre, ma -> 2
    expect(aksharas("प्रेम")).toHaveLength(2);
    // Tamil 'தமிழ்' : ta, mi, zh+pulli -> 3
    expect(aksharas("தமிழ்")).toHaveLength(3);
  });
  it("ignores spaces and punctuation", () => {
    expect(aksharas("ಮಳೆ, ಬಂತು!")).toHaveLength(4);
  });
});

describe("line prosody", () => {
  it("counts aksharas and marks guru by long vowels, anusvara and following conjuncts", () => {
    const p = lineProsody("ಮಳೆ ಬಂತು");
    expect(p.count).toBe(4);
    expect(p.pattern).toHaveLength(4);
    // 'ಬಂ' has anusvara -> guru
    expect(p.pattern[2]).toBe("G");
  });
});

describe("character error rate", () => {
  it("is 0 for identical text and ignores punctuation/space/case", () => {
    expect(charErrorRate("ಮಳೆ ಬಂತು", "ಮಳೆ, ಬಂತು!")).toBe(0);
  });
  it("counts edits relative to the reference length", () => {
    expect(charErrorRate("abcd", "abxd")).toBeCloseTo(0.25, 5);
    expect(charErrorRate("abcd", "")).toBe(1);
  });
});

describe("transcript scoring", () => {
  it("flags lines whose heard text diverges", () => {
    const intended = "ಮಳೆ ಬಂತು ಮನೆ ನೆನಪಾಯ್ತು\nಅಮ್ಮನ ಸೆರಗಿನ ಘಮ";
    const heard = "ಮಳೆ ಬಂತು ಮನೆ ನೆನಪಾಯ್ತು\nಅಮ್ಮನ ಹರಿವಿನ ಕಮ";
    const r = scoreTranscript(intended, heard);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]!.cer).toBe(0);
    expect(r.lines[1]!.flagged).toBe(true);
    expect(r.overall).toBeGreaterThan(0);
    expect(r.matchPct).toBeLessThan(100);
  });
  it("handles a longer transcript by aligning each intended line to its best window", () => {
    const r = scoreTranscript("alpha beta\ngamma delta", "alpha beta gamma delta");
    expect(r.lines.every((l) => !l.flagged)).toBe(true);
  });
});

describe("diction hints", () => {
  it("returns language-specific guidance for Lyria and nothing harmful for unknown languages", () => {
    expect(dictionHints("Kannada")).toMatch(/retroflex/i);
    expect(dictionHints("Hindi")).toMatch(/schwa/i);
    expect(dictionHints("Tamil")).toMatch(/zh|ழ/);
    expect(dictionHints("Klingon")).toBe("");
  });
});

import { auditDiction } from "../lib/diction/gemini";

describe("gemini diction audit", () => {
  it("scores the transcript returned by the model", async () => {
    const fake = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ transcript: "alpha beta\ngamma delta" }) }] } }] }), { status: 200 })) as unknown as typeof fetch;
    const r = await auditDiction("alpha beta\ngamma delta", new Uint8Array([1, 2, 3]), "audio/mpeg", "English", "k", fake);
    expect(r.matchPct).toBe(100);
    expect(r.transcript).toContain("gamma");
  });
  it("surfaces API failures", async () => {
    const bad = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(auditDiction("a", new Uint8Array(), "audio/mpeg", "x", "k", bad)).rejects.toThrow(/gemini qa 500/);
  });
});
