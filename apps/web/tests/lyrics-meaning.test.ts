import { describe, expect, it } from "vitest";
import { buildMeaningPrompt, flattenLyricLines, generateMeaning, parseMeaning } from "../lib/lyrics/meaning";

const sections = [
  { id: "s1", type: "verse", target_seconds: 10, lyrics: "[Verse]\nನಮಸ್ಕಾರ ಗೆಳೆಯ\n\nಮಳೆ ಬಂತು ಇಂದು" },
  { id: "s2", type: "chorus", target_seconds: 10, lyrics: "# Title\nla la\n" },
  { id: "s3", type: "outro", target_seconds: 5 },
];

describe("lyrics meaning", () => {
  it("flattens lyric lines per section, dropping tags, titles and blanks", () => {
    expect(flattenLyricLines(sections).map((l) => [l.section_id, l.original])).toEqual([
      ["s1", "ನಮಸ್ಕಾರ ಗೆಳೆಯ"], ["s1", "ಮಳೆ ಬಂತು ಇಂದು"], ["s2", "la la"],
    ]);
  });
  it("parses a bare or fenced JSON array and rejects wrong length or types", () => {
    expect(parseMeaning('["a","b"]', 2)).toEqual(["a", "b"]);
    expect(parseMeaning('```json\n["a"," b "]\n```', 2)).toEqual(["a", "b"]);
    expect(parseMeaning('["a"]', 2)).toBeNull();
    expect(parseMeaning('["a", 1]', 2)).toBeNull();
    expect(parseMeaning("not json", 1)).toBeNull();
  });
  it("prompt numbers every line and states the count", () => {
    const p = buildMeaningPrompt("Kannada", ["x", "y"]);
    expect(p).toContain("exactly 2 strings");
    expect(p).toContain("2. y");
  });
  it("generateMeaning pairs deterministic romanization with the model translation", async () => {
    const client = { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: '["Hello friend","The rain came today","la la"]' }] }) } };
    const out = await generateMeaning(client as never, { language: "Kannada", sections });
    expect(out).toHaveLength(3);
    expect(out[0]!.english).toBe("Hello friend");
    expect(out[0]!.roman).toMatch(/^[\x00-\x7f]+$/);
    expect(out[2]!.roman).toBe("la la");
  });
  it("throws when the model output cannot be aligned to the lines", async () => {
    const client = { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: '["only one"]' }] }) } };
    await expect(generateMeaning(client as never, { language: "Kannada", sections })).rejects.toThrow(/meaning_parse_failed/);
  });
  it("returns nothing for an instrumental song without calling the model", async () => {
    const client = { messages: { create: async () => { throw new Error("should not be called"); } } };
    expect(await generateMeaning(client as never, { language: "Kannada", sections: [sections[2]!] })).toEqual([]);
  });
});
