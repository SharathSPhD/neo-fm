import { describe, expect, it } from "vitest";

import { mapToSections } from "./section-mapper.js";

const STANZA_BODY = `First stanza line A
First stanza line B

Second stanza line A
Second stanza line B

Third stanza line A
Third stanza line B`;

describe("mapToSections", () => {
  it("maps western with intro/verse/chorus/.../outro and leaves runways lyric-free", () => {
    const sections = mapToSections({
      body: STANZA_BODY,
      style_family: "western",
      script: "latin",
    });
    expect(sections.length).toBeGreaterThanOrEqual(3);
    const intro = sections[0]!;
    expect(intro.type).toBe("intro");
    expect(intro.lyrics).toBeUndefined();
    expect(intro.script).toBeUndefined();
    const last = sections[sections.length - 1]!;
    expect(last.type).toBe("outro");
    expect(last.lyrics).toBeUndefined();
    // every lyric-bearing section carries the script + a non-empty body
    for (const s of sections) {
      if (s.lyrics !== undefined) {
        expect(s.script).toBe("latin");
        expect(s.lyrics.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("maps carnatic into pallavi/anupallavi/charanam with every section bearing lyrics", () => {
    const sections = mapToSections({
      body: STANZA_BODY,
      style_family: "carnatic",
      script: "kannada",
    });
    expect(sections[0]?.type).toBe("pallavi");
    expect(sections[1]?.type).toBe("anupallavi");
    expect(sections[2]?.type).toBe("charanam");
    for (const s of sections) {
      expect(s.lyrics).toBeDefined();
      expect(s.script).toBe("kannada");
    }
  });

  it("maps hindustani into mukhda+antara rotations", () => {
    const sections = mapToSections({
      body: STANZA_BODY,
      style_family: "hindustani",
      script: "devanagari",
    });
    expect(sections[0]?.type).toBe("mukhda");
    expect(sections[1]?.type).toBe("antara");
    for (const s of sections) expect(s.lyrics).toBeDefined();
  });

  it("maps kannada-folk into refrain/stanza rotations", () => {
    const sections = mapToSections({
      body: STANZA_BODY,
      style_family: "kannada-folk",
      script: "kannada",
    });
    expect(sections[0]?.type).toBe("folk_refrain");
    expect(sections[1]?.type).toBe("folk_stanza");
    for (const s of sections) {
      expect(s.lyrics).toBeDefined();
      expect(s.script).toBe("kannada");
    }
  });

  it("rejects an empty body", () => {
    expect(() =>
      mapToSections({ body: "   \n\n   ", style_family: "western", script: "latin" }),
    ).toThrow(/body is empty/);
  });
});
