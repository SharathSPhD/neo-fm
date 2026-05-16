import { describe, expect, it } from "vitest";

import {
  SongDocumentSchema,
  type SongDocument,
} from "@neo-fm/song-doc";

import { TamilFolkCoComposer } from "./tamil-folk.js";

function makeDoc(overrides: Partial<SongDocument> = {}): SongDocument {
  const base: SongDocument = SongDocumentSchema.parse({
    language: "ta",
    style_family: "tamil-folk",
    target_duration_seconds: 90,
    sections: [
      { id: "r1", type: "folk_refrain", target_seconds: 30, lyrics: "அ" },
      { id: "s1", type: "folk_stanza", target_seconds: 30, lyrics: "ஆ" },
      { id: "r2", type: "folk_refrain", target_seconds: 30, lyrics: "அ" },
    ],
  });
  return { ...base, ...overrides };
}

describe("TamilFolkCoComposer", () => {
  const cc = new TamilFolkCoComposer();

  it("populates style + region + janapada genre + time_sig + section tags", async () => {
    const out = await cc.elaborate(makeDoc());
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("style:tamil-folk");
    expect(tags).toContain("region:tamil");
    expect(tags).toContain("genre:janapada");
    expect(tags).toContain("time_sig:4/4");
    expect(tags).toContain("section:folk_refrain");
    expect(tags).toContain("function:refrain");
  });

  it("uses parai + thavil + nadaswaram + flute as default orchestration", async () => {
    const out = await cc.elaborate(makeDoc());
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("lead_vocal:male");
    expect(tags).toContain("instrument:parai");
    expect(tags).toContain("instrument:thavil");
    expect(tags).toContain("instrument:nadaswaram");
    expect(tags).toContain("instrument:flute");
  });

  it("promotes 4/4 dance tempo onto the SongDocument", async () => {
    const out = await cc.elaborate(makeDoc());
    expect(out.tempo_bpm).toBe(124);
    expect(out.time_signature).toBe("4/4");
    expect(out.sections[0]?.tags).toContain("tempo:upbeat");
  });

  it("does not emit a raga tag (folk is not raga-bound)", async () => {
    const out = await cc.elaborate(makeDoc());
    for (const s of out.sections) {
      const ragaTags = (s.tags ?? []).filter((t) => t.startsWith("raga:"));
      expect(ragaTags).toEqual([]);
    }
  });

  it("preserves producer-supplied tempo descriptor (single-valued)", async () => {
    const doc = makeDoc({
      sections: [
        {
          id: "r1",
          type: "folk_refrain",
          target_seconds: 30,
          tags: ["tempo:slow-ballad", "mood:reflective"],
        },
        { id: "s1", type: "folk_stanza", target_seconds: 30 },
        { id: "r2", type: "folk_refrain", target_seconds: 30 },
      ],
    });
    const out = await cc.elaborate(doc);
    const tags = out.sections[0]?.tags ?? [];
    const tempoTags = tags.filter((t) => t.startsWith("tempo:"));
    expect(tempoTags).toEqual(["tempo:slow-ballad"]);
    expect(tags).toContain("mood:reflective");
  });

  it("refuses documents with the wrong style_family", async () => {
    const doc = { ...makeDoc(), style_family: "kannada-folk" } as SongDocument;
    await expect(cc.elaborate(doc)).rejects.toThrow(
      /style_family=kannada-folk/,
    );
  });

  it("re-parses output through SongDocumentSchema", async () => {
    const out = await cc.elaborate(makeDoc());
    expect(() => SongDocumentSchema.parse(out)).not.toThrow();
  });

  it("stamps deterministic metadata with composer name + region", async () => {
    const out1 = await cc.elaborate(makeDoc());
    const out2 = await cc.elaborate(makeDoc());
    expect(out1.metadata).toEqual(out2.metadata);
    const md = out1.metadata as {
      neo_fm_co_composer: { name: string; region: string };
    };
    expect(md.neo_fm_co_composer.name).toBe("TamilFolkCoComposer");
    expect(md.neo_fm_co_composer.region).toBe("tamil");
  });
});
