import { describe, expect, it } from "vitest";

import {
  SongDocumentSchema,
  type SongDocument,
} from "@neo-fm/song-doc";

import { CarnaticCoComposer } from "./carnatic.js";

function makeDoc(overrides: Partial<SongDocument> = {}): SongDocument {
  // Default Carnatic shell: language hi (we accept en/hi/kn -- Carnatic
  // lyrics commonly cross-lingually use Sanskrit / Tamil / Telugu in
  // practice but the DSL pins to en/hi/kn for v1; demo uses hi).
  const base: SongDocument = SongDocumentSchema.parse({
    language: "hi",
    style_family: "carnatic",
    tempo_bpm: 80,
    target_duration_seconds: 90,
    sections: [
      { id: "pal", type: "pallavi", target_seconds: 30, lyrics: "क" },
      { id: "anu", type: "anupallavi", target_seconds: 30, lyrics: "ख" },
      { id: "chr", type: "charanam", target_seconds: 30, lyrics: "ग" },
    ],
  });
  return { ...base, ...overrides };
}

describe("CarnaticCoComposer", () => {
  const cc = new CarnaticCoComposer();

  it("populates style + raga + tala + aroha + section + function tags", async () => {
    const out = await cc.elaborate(makeDoc());
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("style:carnatic");
    expect(tags).toContain("raga:mohanam");
    expect(tags).toContain("aroha:S R2 G3 P D2 S'");
    expect(tags).toContain("avaroha:S' D2 P G3 R2 S");
    expect(tags).toContain("tala:adi");
    expect(tags).toContain("tala_beats:8");
    expect(tags).toContain("section:pallavi");
    expect(tags).toContain("function:theme-statement");
  });

  it("maps section types to Carnatic functions", async () => {
    const out = await cc.elaborate(makeDoc());
    const fnFor = (id: string) => {
      const tags = out.sections.find((s) => s.id === id)?.tags ?? [];
      return tags.find((t) => t.startsWith("function:")) ?? null;
    };
    expect(fnFor("pal")).toBe("function:theme-statement");
    expect(fnFor("anu")).toBe("function:development");
    expect(fnFor("chr")).toBe("function:verse");
  });

  it("honours producer-supplied raga + tala via SongDocument fields", async () => {
    const doc = makeDoc({
      tala: "rupakam",
      raga: {
        name: "kalyani",
        system: "carnatic",
      },
    });
    const out = await cc.elaborate(doc);
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("raga:kalyani");
    // Kalyani's aroha uses M2 (tivra), which is the diagnostic note.
    expect(tags).toContain("aroha:S R2 G3 M2 P D2 N3 S'");
    expect(tags).toContain("tala:rupakam");
    expect(tags).toContain("tala_beats:6");
  });

  it("uses kala tempo descriptors (vilamba / madhyama / durita)", async () => {
    const cases: Array<[number, string]> = [
      [55, "tempo:vilamba"],
      [85, "tempo:madhyama"],
      [130, "tempo:durita"],
    ];
    for (const [bpm, expected] of cases) {
      const out = await cc.elaborate(makeDoc({ tempo_bpm: bpm }));
      expect(out.sections[0]?.tags).toContain(expected);
    }
  });

  it("defaults orchestration to mridangam + tanpura + violin when absent", async () => {
    const out = await cc.elaborate(makeDoc());
    const tags = out.sections[0]?.tags ?? [];
    expect(tags).toContain("lead_vocal:female");
    expect(tags).toContain("instrument:mridangam");
    expect(tags).toContain("instrument:tanpura");
    expect(tags).toContain("instrument:violin");
  });

  it("promotes inferred raga onto the Song Document", async () => {
    const out = await cc.elaborate(makeDoc());
    expect(out.raga?.name).toBe("mohanam");
    expect(out.raga?.system).toBe("carnatic");
    expect(out.raga?.arohana?.[0]).toBe("S");
    expect(out.tala).toBe("adi");
  });

  it("preserves producer-supplied tags (single-valued families win)", async () => {
    const doc = makeDoc({
      sections: [
        {
          id: "pal",
          type: "pallavi",
          target_seconds: 30,
          tags: ["raga:hamsadhwani", "mood:bright"],
        },
        { id: "anu", type: "anupallavi", target_seconds: 30 },
        { id: "chr", type: "charanam", target_seconds: 30 },
      ],
    });
    const out = await cc.elaborate(doc);
    const tags = out.sections[0]?.tags ?? [];
    const ragaTags = tags.filter((t) => t.startsWith("raga:"));
    expect(ragaTags).toEqual(["raga:hamsadhwani"]);
    // free-form producer tag preserved
    expect(tags).toContain("mood:bright");
    expect(tags.indexOf("mood:bright")).toBeLessThan(
      tags.indexOf("style:carnatic"),
    );
  });

  it("emits a deterministic composer metadata block", async () => {
    const out1 = await cc.elaborate(makeDoc());
    const out2 = await cc.elaborate(makeDoc());
    expect(out1.metadata).toEqual(out2.metadata);
    const md = out1.metadata as {
      neo_fm_co_composer: { name: string; raga: string; tala: string };
    };
    expect(md.neo_fm_co_composer.name).toBe("CarnaticCoComposer");
    expect(md.neo_fm_co_composer.raga).toBe("mohanam");
    expect(md.neo_fm_co_composer.tala).toBe("adi");
  });

  it("refuses non-carnatic documents", async () => {
    const doc = { ...makeDoc(), style_family: "western" } as SongDocument;
    await expect(cc.elaborate(doc)).rejects.toThrow(/style_family=western/);
  });

  it("emits a SongDocument that still satisfies SongDocumentSchema", async () => {
    const out = await cc.elaborate(makeDoc());
    expect(() => SongDocumentSchema.parse(out)).not.toThrow();
  });
});
