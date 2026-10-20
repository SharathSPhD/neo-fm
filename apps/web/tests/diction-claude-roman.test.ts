import { describe, expect, it } from "vitest";

import { buildRomanPrompt, claudeRomanLanguages, claudeRomanize, parseRoman, romanSample } from "../lib/diction/claude-roman";

const TA = "## Hook\nவாழை இலை வளைவில்\nதாலி ஒளிரும்\n\n## Verse 1\nபெரியவர் கைகள்";

describe("claude romanization", () => {
  it("is off unless a language is listed", () => {
    expect(claudeRomanLanguages({}).size).toBe(0);
    expect(claudeRomanLanguages({ DICTION_CLAUDE_ROMAN: "" }).size).toBe(0);
    expect([...claudeRomanLanguages({ DICTION_CLAUDE_ROMAN: " ta, TE " })]).toEqual(["ta", "te"]);
  });

  it("sends only native lines and puts the answers back under the tags", async () => {
    let prompt = "";
    const out = await claudeRomanize(TA, "Tamil", async (p) => { prompt = p; return '["vaazhai ilai valaivil","thaali olirum","periyavar kaigal"]'; });
    expect(prompt).toContain("exactly 3 strings");
    expect(prompt).not.toContain("## Hook");
    expect(out).toBe("## Hook\nvaazhai ilai valaivil\nthaali olirum\n\n## Verse 1\nperiyavar kaigal");
  });

  it("returns null on a wrong count, non-Latin output, a fenced non-array, or a thrown call", async () => {
    expect(parseRoman('["a"]', 2)).toBeNull();
    expect(parseRoman('["வாழை"]', 1)).toBeNull();
    expect(parseRoman("not json", 1)).toBeNull();
    expect(parseRoman('```json\n["vaazhai"]\n```', 1)).toEqual(["vaazhai"]);
    expect(await claudeRomanize(TA, "Tamil", async () => '["x"]')).toBeNull();
    expect(await claudeRomanize(TA, "Tamil", async () => { throw new Error("429"); })).toBeNull();
  });

  it("does nothing for Latin-only lyrics", async () => {
    let called = false;
    expect(await claudeRomanize("## Hook\nla la la", "Tamil", async () => { called = true; return "[]"; })).toBeNull();
    expect(called).toBe(false);
    expect(buildRomanPrompt("Tamil", ["a"])).toContain("1. a");
  });

  it("samples the first lyric lines for the trace", () => {
    expect(romanSample("## Hook\nvaazhai ilai\n\nthaali olirum\n\n## Verse 1\nperiyavar")).toBe("vaazhai ilai / thaali olirum");
  });
});
