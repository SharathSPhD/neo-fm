import { describe, expect, it } from "vitest";
import { lyricLines, meterIssues } from "../lib/lyrics/prosody-lint";

describe("meter lint", () => {
  it("ignores titles and section tags", () => {
    expect(lyricLines("# Title\n[Pallavi]\nline one\n\n**[Charanam]**\nline two")).toEqual(["line one", "line two"]);
  });
  it("flags a badly unbalanced Telugu couplet but not a balanced one", () => {
    const balanced = "వేకువ నదిపై తేలే దీపం\nనీకే అర్పణ నా ప్రణామం";
    const skewed = "వేకువ నదిపై తేలే ఒంటరి దీపం కాంతి రేఖలా మెరిసెను\nనీకే ప్రణామం";
    expect(meterIssues(balanced)).toEqual([]);
    expect(meterIssues(skewed).length).toBe(1);
  });
});
