import { describe, expect, it } from "vitest";
import { singingScript } from "../lib/diction/romanize";

describe("singing script", () => {
  it("adds romanization under native lines, keeps tags, leaves Latin alone", () => {
    const r = singingScript("## పల్లవి\nఅజ్జి కథ\n\n[Chorus]\nla la la");
    expect(r.romanized).toBe(true);
    expect(r.text).toContain("[పల్లవి]");
    expect(r.text).toMatch(/అజ్జి కథ\n\(.*\)/);
    expect(r.text).toContain("[Chorus]");
    expect(r.text).toContain("la la la");
    expect(r.text).not.toMatch(/la la la\n\(/);
  });
  it("is a no-op marker for Latin-only lyrics", () => {
    expect(singingScript("hello world").romanized).toBe(false);
  });
});
