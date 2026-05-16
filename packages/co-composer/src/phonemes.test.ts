/**
 * v1.3 Sprint 4: verify that the co-composers attach phonemes for
 * Indic-language documents and leave English / no-lyric sections
 * alone.
 */
import { describe, expect, it } from "vitest";

import {
  HindustaniCoComposer,
  KannadaFolkCoComposer,
  KannadaLightClassicalCoComposer,
  TamilFolkCoComposer,
  WesternCoComposer,
} from "./index.js";

import type { SongDocument } from "@neo-fm/song-doc";

function baseDoc(overrides: Partial<SongDocument>): SongDocument {
  return {
    language: "en",
    style_family: "western",
    target_duration_seconds: 60,
    sections: [],
    ...overrides,
  } as SongDocument;
}

describe("co-composer phoneme emission (v1.3 Sprint 4)", () => {
  it("HindustaniCoComposer fills section.phonemes for a Hindi song with Devanagari lyrics", async () => {
    const doc = baseDoc({
      language: "hi",
      style_family: "hindustani",
      sections: [
        {
          id: "mukhda",
          type: "mukhda",
          lyrics: "नमस्कार",
          script: "devanagari",
          target_seconds: 60,
        },
      ],
    });
    const out = await new HindustaniCoComposer().elaborate(doc);
    const first = out.sections[0];
    expect(first?.phonemes).toEqual(["n", "a", "m", "a", "s", "k", "aa", "r"]);
  });

  it("KannadaLightClassicalCoComposer emits phonemes for kn lyrics", async () => {
    const doc = baseDoc({
      language: "kn",
      style_family: "kannada-light-classical",
      sections: [
        {
          id: "pallavi",
          type: "pallavi",
          lyrics: "ಕವಿ",
          script: "kannada",
          target_seconds: 60,
        },
      ],
    });
    const out = await new KannadaLightClassicalCoComposer().elaborate(doc);
    expect(out.sections[0]?.phonemes).toEqual(["k", "a", "v", "i"]);
  });

  it("TamilFolkCoComposer emits canonicalised Tamil phonemes", async () => {
    const doc = baseDoc({
      language: "ta",
      style_family: "tamil-folk",
      sections: [
        {
          id: "refrain",
          type: "folk_refrain",
          lyrics: "வணக்கம்",
          script: "tamil",
          target_seconds: 60,
        },
      ],
    });
    const out = await new TamilFolkCoComposer().elaborate(doc);
    expect(out.sections[0]?.phonemes).toEqual([
      "v",
      "a",
      "N",
      "a",
      "k",
      "k",
      "a",
      "m",
    ]);
  });

  it("KannadaFolkCoComposer attaches phonemes only to sections with lyrics", async () => {
    const doc = baseDoc({
      language: "kn",
      style_family: "kannada-folk",
      sections: [
        { id: "intro", type: "intro", target_seconds: 10 }, // no lyrics
        {
          id: "v1",
          type: "folk_stanza",
          lyrics: "ಕವಿ",
          script: "kannada",
          target_seconds: 50,
        },
      ],
    });
    const out = await new KannadaFolkCoComposer().elaborate(doc);
    expect(out.sections[0]?.phonemes).toBeUndefined();
    expect(out.sections[1]?.phonemes).toEqual(["k", "a", "v", "i"]);
  });

  it("WesternCoComposer does NOT attach phonemes to a plain English song", async () => {
    const doc = baseDoc({
      sections: [
        {
          id: "v1",
          type: "verse",
          lyrics: "Hello world",
          script: "latin",
          target_seconds: 60,
        },
      ],
    });
    const out = await new WesternCoComposer().elaborate(doc);
    expect(out.sections[0]?.phonemes).toBeUndefined();
  });

  it("never overwrites producer-supplied phonemes", async () => {
    const doc = baseDoc({
      language: "hi",
      style_family: "hindustani",
      sections: [
        {
          id: "mukhda",
          type: "mukhda",
          lyrics: "नमस्कार",
          script: "devanagari",
          phonemes: ["custom"],
          target_seconds: 60,
        },
      ],
    });
    const out = await new HindustaniCoComposer().elaborate(doc);
    expect(out.sections[0]?.phonemes).toEqual(["custom"]);
  });
});
