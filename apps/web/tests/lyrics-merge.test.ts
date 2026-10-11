import { describe, expect, it } from "vitest";

import { mergeLyrics, parseBlocks } from "../lib/agent/lyrics-merge";

type Doc = { sections: { id: string; type: string; lyrics?: string }[] };
const md = "[Mukhda]\nline one\nline two\n\n[Antara]\nline three\n";

describe("lyrics merge", () => {
  it("parses tagged blocks", () => expect(parseBlocks(md).map((b) => b.tag)).toEqual(["Mukhda", "Antara"]));
  it("matches by type and leaves instrumental sections alone", () => {
    const doc: Doc = { sections: [{ id: "s1", type: "alaap" }, { id: "s2", type: "mukhda" }, { id: "s3", type: "antara" }] };
    const out = mergeLyrics(doc, md);
    expect(out.sections.map((s) => s.lyrics)).toEqual([undefined, "line one\nline two", "line three"]);
  });
  it("fills lyric sections in order when tags do not match, without adding sections", () => {
    const doc: Doc = { sections: [{ id: "a", type: "verse" }, { id: "b", type: "chorus" }] };
    const out = mergeLyrics(doc, md);
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0]!.lyrics).toBe("line one\nline two");
  });
  it("appends leftover blocks instead of dropping them, and caps length", () => {
    const doc: Doc = { sections: [{ id: "a", type: "mukhda" }] };
    const out = mergeLyrics(doc, md + "\n[Extra]\nmore\n");
    expect(out.sections[0]!.lyrics).toContain("line three");
    expect(out.sections[0]!.lyrics).toContain("more");
    expect(mergeLyrics(doc, "[Mukhda]\n" + "x".repeat(5000)).sections[0]!.lyrics!.length).toBe(2000);
  });
  it("is a no-op on empty input", () => {
    const doc: Doc = { sections: [{ id: "a", type: "mukhda" }] };
    expect(mergeLyrics(doc, "")).toBe(doc);
  });
});
