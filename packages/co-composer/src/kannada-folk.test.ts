import { describe, expect, it } from "vitest";

import {
  SongDocumentSchema,
  type SongDocument,
} from "@neo-fm/song-doc";

import { KannadaFolkCoComposer } from "./kannada-folk.js";

function makeDoc(overrides: Partial<SongDocument> = {}): SongDocument {
  const base: SongDocument = SongDocumentSchema.parse({
    language: "kn",
    style_family: "kannada-folk",
    target_duration_seconds: 90,
    sections: [
      { id: "r1", type: "folk_refrain", target_seconds: 30, lyrics: "ಆ" },
      { id: "s1", type: "folk_stanza", target_seconds: 30, lyrics: "ಇ" },
      { id: "r2", type: "folk_refrain", target_seconds: 30, lyrics: "ಆ" },
    ],
  });
  return { ...base, ...overrides };
}

describe("KannadaFolkCoComposer", () => {
  const cc = new KannadaFolkCoComposer();

  it("populates style + genre + time_sig + tempo + section + function tags", async () => {
    const out = await cc.elaborate(makeDoc());
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("style:kannada-folk");
    expect(tags).toContain("genre:bhavageete");
    expect(tags).toContain("time_sig:6/8");
    expect(tags).toContain("tempo:mid-tempo");
    expect(tags).toContain("section:folk_refrain");
    expect(tags).toContain("function:refrain");
  });

  it("maps folk section types to refrain / stanza functions", async () => {
    const out = await cc.elaborate(makeDoc());
    const fnFor = (id: string) => {
      const tags = out.sections.find((s) => s.id === id)?.tags ?? [];
      return tags.find((t) => t.startsWith("function:")) ?? null;
    };
    expect(fnFor("r1")).toBe("function:refrain");
    expect(fnFor("s1")).toBe("function:stanza");
  });

  it("honours metadata.genre = janapada for folk songs", async () => {
    const doc = makeDoc({ metadata: { genre: "janapada" } });
    const out = await cc.elaborate(doc);
    expect(out.sections[0]?.tags).toContain("genre:janapada");
  });

  it("does NOT emit raga: tags for folk style", async () => {
    const out = await cc.elaborate(makeDoc());
    for (const s of out.sections) {
      const ragaTags = (s.tags ?? []).filter((t) => t.startsWith("raga:"));
      expect(ragaTags).toEqual([]);
    }
  });

  it("defaults orchestration to dhol + flute + tabla + percussion", async () => {
    const out = await cc.elaborate(makeDoc());
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("lead_vocal:female");
    expect(tags).toContain("instrument:dhol");
    expect(tags).toContain("instrument:flute");
    expect(tags).toContain("instrument:tabla");
  });

  it("uses tempo descriptors (ballad / mid-tempo / upbeat / dance)", async () => {
    const cases: Array<[number, string]> = [
      [60, "tempo:ballad"],
      [100, "tempo:mid-tempo"],
      [125, "tempo:upbeat"],
      [150, "tempo:dance"],
    ];
    for (const [bpm, expected] of cases) {
      const out = await cc.elaborate(makeDoc({ tempo_bpm: bpm }));
      expect(out.sections[0]?.tags).toContain(expected);
    }
  });

  it("promotes default tempo + time signature onto the Song Document", async () => {
    const out = await cc.elaborate(makeDoc());
    expect(out.tempo_bpm).toBe(110);
    expect(out.time_signature).toBe("6/8");
  });

  it("preserves producer-supplied tags (single-valued families win)", async () => {
    const doc = makeDoc({
      sections: [
        {
          id: "r1",
          type: "folk_refrain",
          target_seconds: 30,
          tags: ["time_sig:4/4", "mood:celebratory"],
        },
        { id: "s1", type: "folk_stanza", target_seconds: 30 },
        { id: "r2", type: "folk_refrain", target_seconds: 30 },
      ],
    });
    const out = await cc.elaborate(doc);
    const tags = out.sections[0]?.tags ?? [];
    const timeSigTags = tags.filter((t) => t.startsWith("time_sig:"));
    expect(timeSigTags).toEqual(["time_sig:4/4"]);
    expect(tags).toContain("mood:celebratory");
  });

  it("emits a deterministic composer metadata block", async () => {
    const out1 = await cc.elaborate(makeDoc());
    const out2 = await cc.elaborate(makeDoc());
    expect(out1.metadata).toEqual(out2.metadata);
    const md = out1.metadata as {
      neo_fm_co_composer: { name: string; genre: string };
    };
    expect(md.neo_fm_co_composer.name).toBe("KannadaFolkCoComposer");
    expect(md.neo_fm_co_composer.genre).toBe("bhavageete");
  });

  it("refuses non-kannada-folk documents", async () => {
    const doc = { ...makeDoc(), style_family: "western" } as SongDocument;
    await expect(cc.elaborate(doc)).rejects.toThrow(/style_family=western/);
  });

  it("emits a SongDocument that still satisfies SongDocumentSchema", async () => {
    const out = await cc.elaborate(makeDoc());
    expect(() => SongDocumentSchema.parse(out)).not.toThrow();
  });
});
