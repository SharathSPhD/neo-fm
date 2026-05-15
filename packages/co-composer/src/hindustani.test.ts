import { describe, expect, it } from "vitest";

import {
  SongDocumentSchema,
  type SongDocument,
} from "@neo-fm/song-doc";

import { HindustaniCoComposer } from "./hindustani.js";

function makeDoc(overrides: Partial<SongDocument> = {}): SongDocument {
  const base: SongDocument = SongDocumentSchema.parse({
    language: "hi",
    style_family: "hindustani",
    tempo_bpm: 90,
    target_duration_seconds: 90,
    sections: [
      { id: "muk", type: "mukhda", target_seconds: 30, lyrics: "अ" },
      { id: "ant", type: "antara", target_seconds: 30, lyrics: "आ" },
      { id: "ant2", type: "antara", target_seconds: 30, lyrics: "इ" },
    ],
  });
  return { ...base, ...overrides };
}

describe("HindustaniCoComposer", () => {
  const cc = new HindustaniCoComposer();

  it("populates style + raga + tala + aroha + section + function tags", async () => {
    const out = await cc.elaborate(makeDoc());
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("style:hindustani");
    expect(tags).toContain("raga:yaman");
    // Yaman aroha starts on N (the diagnostic note that distinguishes it
    // from Kalyan).
    expect(tags).toContain("aroha:N3 R2 G3 M2 P D2 N3 S'");
    expect(tags).toContain("tala:teentaal");
    expect(tags).toContain("tala_beats:16");
    expect(tags).toContain("section:mukhda");
    expect(tags).toContain("function:theme-statement");
  });

  it("honours producer-supplied raga + tala", async () => {
    const doc = makeDoc({
      tala: "ektaal",
      raga: {
        name: "bhairavi",
        system: "hindustani",
      },
    });
    const out = await cc.elaborate(doc);
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("raga:bhairavi");
    // Hindustani Bhairavi uses komal Re (R1), G2, D1, N2.
    expect(tags).toContain("aroha:S R1 G2 M1 P D1 N2 S'");
    expect(tags).toContain("tala:ektaal");
    expect(tags).toContain("tala_beats:12");
  });

  it("uses lay tempo descriptors (vilambit / madhya / drut)", async () => {
    const cases: Array<[number, string]> = [
      [60, "tempo:vilambit"],
      [100, "tempo:madhya"],
      [150, "tempo:drut"],
    ];
    for (const [bpm, expected] of cases) {
      const out = await cc.elaborate(makeDoc({ tempo_bpm: bpm }));
      expect(out.sections[0]?.tags).toContain(expected);
    }
  });

  it("defaults orchestration to harmonium + tabla + tanpura when absent", async () => {
    const out = await cc.elaborate(makeDoc());
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("lead_vocal:female");
    expect(tags).toContain("instrument:harmonium");
    expect(tags).toContain("instrument:tabla");
    expect(tags).toContain("instrument:tanpura");
  });

  it("promotes inferred raga onto the Song Document with system=hindustani", async () => {
    const out = await cc.elaborate(makeDoc());
    expect(out.raga?.name).toBe("yaman");
    expect(out.raga?.system).toBe("hindustani");
    expect(out.tala).toBe("teentaal");
  });

  it("preserves producer-supplied tags (single-valued families win)", async () => {
    const doc = makeDoc({
      sections: [
        {
          id: "muk",
          type: "mukhda",
          target_seconds: 30,
          tags: ["tala:dadra", "mood:devotional"],
        },
        { id: "ant", type: "antara", target_seconds: 30 },
        { id: "ant2", type: "antara", target_seconds: 30 },
      ],
    });
    const out = await cc.elaborate(doc);
    const tags = out.sections[0]?.tags ?? [];
    const talaTags = tags.filter((t) => t.startsWith("tala:"));
    expect(talaTags).toEqual(["tala:dadra"]);
    expect(tags).toContain("mood:devotional");
  });

  it("emits a deterministic composer metadata block", async () => {
    const out1 = await cc.elaborate(makeDoc());
    const out2 = await cc.elaborate(makeDoc());
    expect(out1.metadata).toEqual(out2.metadata);
    const md = out1.metadata as {
      neo_fm_co_composer: { name: string; raga: string; tala: string };
    };
    expect(md.neo_fm_co_composer.name).toBe("HindustaniCoComposer");
    expect(md.neo_fm_co_composer.raga).toBe("yaman");
  });

  it("refuses non-hindustani documents", async () => {
    const doc = { ...makeDoc(), style_family: "carnatic" } as SongDocument;
    await expect(cc.elaborate(doc)).rejects.toThrow(/style_family=carnatic/);
  });

  it("emits a SongDocument that still satisfies SongDocumentSchema", async () => {
    const out = await cc.elaborate(makeDoc());
    expect(() => SongDocumentSchema.parse(out)).not.toThrow();
  });
});
