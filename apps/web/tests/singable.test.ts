import { describe, expect, it } from "vitest";
import { singableLines } from "../lib/lyrics/singable";

describe("singableLines", () => {
  it("drops headers, markdown and blanks", () => {
    expect(singableLines("## Verse 1\n\nतेरी याद आई\n**Chorus**\n[Hook]\nPallavi\nla la la, hey")).toEqual(["तेरी याद आई", "la la la, hey"]);
  });
});
