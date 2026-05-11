import { describe, expect, it } from "vitest";

import {
  SongDocumentSchema,
  type SongDocument,
} from "@neo-fm/song-doc";

import { WesternCoComposer } from "./western.js";

function makeDoc(overrides: Partial<SongDocument> = {}): SongDocument {
  const base: SongDocument = SongDocumentSchema.parse({
    language: "en",
    style_family: "western",
    tempo_bpm: 112,
    time_signature: "4/4",
    target_duration_seconds: 90,
    orchestration: {
      lead_vocal: "female",
      instruments: ["acoustic_guitar", "bass"],
      texture: "full-band",
    },
    sections: [
      { id: "intro", type: "intro", target_seconds: 16 },
      { id: "v1", type: "verse", target_seconds: 28, lyrics: "verse one" },
      { id: "c1", type: "chorus", target_seconds: 30, lyrics: "chorus" },
      { id: "outro", type: "outro", target_seconds: 16 },
    ],
  });
  return { ...base, ...overrides };
}

describe("WesternCoComposer", () => {
  const cc = new WesternCoComposer();

  it("populates per-section tags with style + section + key + progression", async () => {
    const out = await cc.elaborate(makeDoc());
    expect(out.sections[0]?.tags).toContain("style:western");
    expect(out.sections[0]?.tags).toContain("section:intro");
    expect(out.sections[0]?.tags).toContain("key:C");
    expect(out.sections[0]?.tags).toContain("progression:C-G-Am-F");
  });

  it("emits per-section progressions matching the section type", async () => {
    const out = await cc.elaborate(makeDoc());
    const tagFor = (id: string) =>
      out.sections.find((s) => s.id === id)?.tags ?? [];
    expect(tagFor("intro")).toContain("progression:C-G-Am-F");
    expect(tagFor("v1")).toContain("progression:Am-F-C-G");
    expect(tagFor("c1")).toContain("progression:C-G-Am-F");
    expect(tagFor("outro")).toContain("progression:C-Am-F-G");
  });

  it("respects metadata.key when set", async () => {
    const doc = makeDoc({
      metadata: { key: "G" },
    });
    const out = await cc.elaborate(doc);
    expect(out.sections[0]?.tags).toContain("key:G");
    expect(out.sections[0]?.tags).toContain("progression:G-D-Em-C");
  });

  it("maps tempo_bpm into discrete descriptors", async () => {
    const cases: Array<[number, string]> = [
      [60, "tempo:ballad"],
      [95, "tempo:mid-tempo"],
      [120, "tempo:upbeat"],
      [150, "tempo:dance"],
    ];
    for (const [bpm, expected] of cases) {
      const out = await cc.elaborate(makeDoc({ tempo_bpm: bpm }));
      expect(out.sections[0]?.tags).toContain(expected);
    }
  });

  it("forwards orchestration as instrument:/lead_vocal:/texture: tags", async () => {
    const out = await cc.elaborate(makeDoc());
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("lead_vocal:female");
    expect(tags).toContain("texture:full-band");
    expect(tags).toContain("instrument:acoustic_guitar");
    expect(tags).toContain("instrument:bass");
  });

  it("preserves producer-supplied tags (no clobber, no duplicates)", async () => {
    const doc = makeDoc({
      sections: [
        {
          id: "intro",
          type: "intro",
          target_seconds: 16,
          tags: ["mood:bright", "style:western"],
        },
        { id: "v1", type: "verse", target_seconds: 28, lyrics: "verse one" },
        { id: "c1", type: "chorus", target_seconds: 30, lyrics: "chorus" },
        { id: "outro", type: "outro", target_seconds: 16 },
      ],
    });
    const out = await cc.elaborate(doc);
    const intro = out.sections[0]?.tags ?? [];
    expect(intro.indexOf("mood:bright")).toBe(0);
    expect(intro.filter((t: string) => t === "style:western").length).toBe(1);
  });

  it("writes a deterministic composer metadata block", async () => {
    const out1 = await cc.elaborate(makeDoc());
    const out2 = await cc.elaborate(makeDoc());
    expect(out1.metadata).toEqual(out2.metadata);
    const md = out1.metadata as { composer: { name: string; key: string } };
    expect(md.composer.name).toBe("WesternCoComposer");
    expect(md.composer.key).toBe("C");
  });

  it("refuses non-western documents", async () => {
    const doc = { ...makeDoc(), style_family: "carnatic" } as SongDocument;
    await expect(cc.elaborate(doc)).rejects.toThrow(/style_family=carnatic/);
  });

  it("emits a SongDocument that still satisfies SongDocumentSchema", async () => {
    const out = await cc.elaborate(makeDoc());
    expect(() => SongDocumentSchema.parse(out)).not.toThrow();
  });
});
