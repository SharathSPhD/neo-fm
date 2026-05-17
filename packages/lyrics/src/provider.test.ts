import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SongDocumentSchema } from "@neo-fm/song-doc";

import {
  PratyabhijnaProvider,
  PublicLyricsLibraryProvider,
} from "./provider.js";

const here = dirname(fileURLToPath(import.meta.url));
// packages/lyrics/src -> packages/lyrics -> packages -> repo root
const REPO_ROOT = resolve(here, "..", "..", "..");
const CORPUS = resolve(REPO_ROOT, "data", "public-lyrics");

describe("PublicLyricsLibraryProvider", () => {
  it("emits a SongDocument that satisfies SongDocumentSchema for western/en", async () => {
    const p = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    const doc = await p.generate({
      language: "en",
      style_family: "western",
      target_duration_seconds: 60,
    });
    expect(() => SongDocumentSchema.parse(doc)).not.toThrow();
    expect(doc.language).toBe("en");
    expect(doc.style_family).toBe("western");
    expect(doc.target_duration_seconds).toBe(60);
    const sum = doc.sections.reduce((acc, s) => acc + s.target_seconds, 0);
    expect(sum).toBe(60);
    expect(doc.sections[0]?.type).toBe("intro");
    expect(doc.sections.at(-1)?.type).toBe("outro");
  });

  it("emits a SongDocument that satisfies SongDocumentSchema for carnatic/kn", async () => {
    const p = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    const doc = await p.generate({
      language: "kn",
      style_family: "carnatic",
      target_duration_seconds: 90,
    });
    expect(() => SongDocumentSchema.parse(doc)).not.toThrow();
    expect(doc.sections[0]?.type).toBe("pallavi");
    for (const s of doc.sections) {
      // Carnatic-shape: every section has lyrics + kannada script.
      expect(s.lyrics).toBeDefined();
      expect(s.script).toBe("kannada");
    }
  });

  it("emits a SongDocument that satisfies SongDocumentSchema for hindustani/hi", async () => {
    const p = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    const doc = await p.generate({
      language: "hi",
      style_family: "hindustani",
      target_duration_seconds: 60,
    });
    expect(() => SongDocumentSchema.parse(doc)).not.toThrow();
    expect(doc.sections[0]?.type).toBe("mukhda");
    for (const s of doc.sections) {
      expect(s.lyrics).toBeDefined();
      expect(s.script).toBe("devanagari");
    }
  });

  it("emits a SongDocument that satisfies SongDocumentSchema for kannada-folk/kn", async () => {
    const p = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    const doc = await p.generate({
      language: "kn",
      style_family: "kannada-folk",
      target_duration_seconds: 60,
    });
    expect(() => SongDocumentSchema.parse(doc)).not.toThrow();
    expect(doc.sections[0]?.type).toBe("folk_refrain");
  });

  it("refuses language/style mismatches (en + carnatic)", async () => {
    const p = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    await expect(
      p.generate({
        language: "en",
        style_family: "carnatic",
        target_duration_seconds: 60,
      }),
    ).rejects.toThrow(/is not paired with style_family=carnatic/);
  });

  // v1.4 Sprint 6: new families that landed PD material this sprint.
  it("emits a SongDocument for bengali-rabindrasangeet/bn", async () => {
    const p = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    const doc = await p.generate({
      language: "bn",
      style_family: "bengali-rabindrasangeet",
      target_duration_seconds: 60,
    });
    expect(() => SongDocumentSchema.parse(doc)).not.toThrow();
    expect(doc.sections[0]?.type).toBe("mukhda");
    for (const s of doc.sections) {
      expect(s.script).toBe("bengali");
    }
  });

  it("emits a SongDocument for telugu-keerthana/te", async () => {
    const p = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    const doc = await p.generate({
      language: "te",
      style_family: "telugu-keerthana",
      target_duration_seconds: 90,
    });
    expect(() => SongDocumentSchema.parse(doc)).not.toThrow();
    expect(doc.sections[0]?.type).toBe("pallavi");
  });

  it("emits a SongDocument for sanskrit-shloka/sa", async () => {
    const p = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    const doc = await p.generate({
      language: "sa",
      style_family: "sanskrit-shloka",
      target_duration_seconds: 60,
    });
    expect(() => SongDocumentSchema.parse(doc)).not.toThrow();
    expect(doc.sections[0]?.type).toBe("shloka_verse");
    for (const s of doc.sections) {
      if (s.lyrics) expect(s.script).toBe("devanagari");
    }
  });

  it("FS-driven allow-list: carnatic now accepts kn and sa once on disk", async () => {
    // Both kn and sa are present in the corpus this sprint, so the
    // allow-list (preference ∩ bundled languages) should let either through.
    const p = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    await expect(
      p.generate({
        language: "kn",
        style_family: "carnatic",
        target_duration_seconds: 60,
      }),
    ).resolves.toBeDefined();
    await expect(
      p.generate({
        language: "sa",
        style_family: "carnatic",
        target_duration_seconds: 60,
      }),
    ).resolves.toBeDefined();
  });

  it("attributes the source under metadata.neo_fm_lyrics_provider", async () => {
    const p = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    const doc = await p.generate({
      language: "hi",
      style_family: "hindustani",
      reference_lyrics: "kabir-pothi",
      target_duration_seconds: 30,
    });
    const md = doc.metadata as {
      neo_fm_lyrics_provider: {
        entry_id: string;
        entry_title: string;
        entry_author: string;
        entry_license: string;
      };
    };
    expect(md.neo_fm_lyrics_provider.entry_id).toBe("hi/kabir-pothi");
    expect(md.neo_fm_lyrics_provider.entry_author).toBe("Kabir");
    expect(md.neo_fm_lyrics_provider.entry_license).toBe("public-domain");
  });

  it("is deterministic — same request -> identical document", async () => {
    const p = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    const req = {
      language: "en" as const,
      style_family: "western" as const,
      target_duration_seconds: 60 as const,
    };
    const a = await p.generate(req);
    const b = await p.generate(req);
    expect(a).toEqual(b);
  });

  it("PratyabhijnaProvider still throws NotYetIntegratedError", async () => {
    const p = new PratyabhijnaProvider();
    await expect(
      p.generate({
        language: "hi",
        style_family: "hindustani",
        target_duration_seconds: 60,
      }),
    ).rejects.toThrow(/Pratyabhijna.*Phase 10/);
  });
});
