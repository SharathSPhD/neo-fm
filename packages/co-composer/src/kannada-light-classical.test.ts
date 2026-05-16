import { describe, expect, it } from "vitest";

import {
  SongDocumentSchema,
  type SongDocument,
} from "@neo-fm/song-doc";

import { KannadaLightClassicalCoComposer } from "./kannada-light-classical.js";

function makeDoc(overrides: Partial<SongDocument> = {}): SongDocument {
  const base: SongDocument = SongDocumentSchema.parse({
    language: "kn",
    style_family: "kannada-light-classical",
    target_duration_seconds: 90,
    sections: [
      { id: "p1", type: "pallavi", target_seconds: 30, lyrics: "ಆ" },
      { id: "c1", type: "charanam", target_seconds: 30, lyrics: "ಇ" },
      { id: "p2", type: "pallavi", target_seconds: 30, lyrics: "ಆ" },
    ],
  });
  return { ...base, ...overrides };
}

describe("KannadaLightClassicalCoComposer", () => {
  const cc = new KannadaLightClassicalCoComposer();

  it("populates style + bhavageete genre + register + section tags", async () => {
    const out = await cc.elaborate(makeDoc());
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("style:kannada-light-classical");
    expect(tags).toContain("genre:bhavageete");
    expect(tags).toContain("register:light-classical");
    expect(tags).toContain("section:pallavi");
    expect(tags).toContain("function:refrain");
  });

  it("uses harmonium + tabla + tanpura + flute as default orchestration", async () => {
    const out = await cc.elaborate(makeDoc());
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("lead_vocal:female");
    expect(tags).toContain("instrument:harmonium");
    expect(tags).toContain("instrument:tabla");
    expect(tags).toContain("instrument:tanpura");
    expect(tags).toContain("instrument:flute");
  });

  it("promotes a slower default tempo than folk (bhavageete is mid-tempo lyric)", async () => {
    const out = await cc.elaborate(makeDoc());
    expect(out.tempo_bpm).toBe(88);
    expect(out.time_signature).toBe("6/8");
    expect(out.sections[0]?.tags).toContain("tempo:mid-tempo");
  });

  it("maps charanam → stanza and pallavi → refrain", async () => {
    const out = await cc.elaborate(makeDoc());
    const fnFor = (id: string) =>
      (out.sections.find((s) => s.id === id)?.tags ?? []).find((t) =>
        t.startsWith("function:"),
      );
    expect(fnFor("p1")).toBe("function:refrain");
    expect(fnFor("c1")).toBe("function:stanza");
  });

  it("does not emit a raga tag (bhavageete is not raga-bound)", async () => {
    const out = await cc.elaborate(makeDoc());
    for (const s of out.sections) {
      const ragaTags = (s.tags ?? []).filter((t) => t.startsWith("raga:"));
      expect(ragaTags).toEqual([]);
    }
  });

  it("preserves producer-supplied single-valued tags", async () => {
    const doc = makeDoc({
      sections: [
        {
          id: "p1",
          type: "pallavi",
          target_seconds: 30,
          tags: ["time_sig:7/8", "mood:contemplative"],
        },
        { id: "c1", type: "charanam", target_seconds: 30 },
        { id: "p2", type: "pallavi", target_seconds: 30 },
      ],
    });
    const out = await cc.elaborate(doc);
    const tags = out.sections[0]?.tags ?? [];
    const timeSigTags = tags.filter((t) => t.startsWith("time_sig:"));
    expect(timeSigTags).toEqual(["time_sig:7/8"]);
    expect(tags).toContain("mood:contemplative");
  });

  it("refuses documents with the wrong style_family", async () => {
    const doc = { ...makeDoc(), style_family: "kannada-folk" } as SongDocument;
    await expect(cc.elaborate(doc)).rejects.toThrow(
      /style_family=kannada-folk/,
    );
  });

  it("rejects invalid tempo_bpm", async () => {
    const cc2 = new KannadaLightClassicalCoComposer();
    // 300 is outside the SongDocumentSchema range but we have to
    // bypass Zod to actually drive the composer's own guard.
    const doc = { ...makeDoc(), tempo_bpm: 300 } as SongDocument;
    await expect(cc2.elaborate(doc)).rejects.toThrow(/tempo_bpm=300/);
  });

  it("stamps deterministic metadata with composer name + register", async () => {
    const out1 = await cc.elaborate(makeDoc());
    const out2 = await cc.elaborate(makeDoc());
    expect(out1.metadata).toEqual(out2.metadata);
    const md = out1.metadata as {
      neo_fm_co_composer: { name: string; register: string };
    };
    expect(md.neo_fm_co_composer.name).toBe(
      "KannadaLightClassicalCoComposer",
    );
    expect(md.neo_fm_co_composer.register).toBe("light-classical");
  });

  it("re-parses output through SongDocumentSchema", async () => {
    const out = await cc.elaborate(makeDoc());
    expect(() => SongDocumentSchema.parse(out)).not.toThrow();
  });
});
