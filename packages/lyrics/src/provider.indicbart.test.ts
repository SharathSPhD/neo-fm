import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

import {
  FallbackLyricProvider,
  IndicBARTLyricProvider,
  PublicLyricsLibraryProvider,
  type LyricsRequest,
} from "./provider.js";

// Reuse the bundled corpus the other tests point at, so the fallback's
// "primary failed" branch is also reachable.
const CORPUS = fileURLToPath(
  new URL("../../../data/public-lyrics", import.meta.url),
);

function fakeFetchOk(body: object): typeof fetch {
  return vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function fakeFetchErr(status: number, text: string): typeof fetch {
  return vi.fn(async () => {
    return new Response(text, {
      status,
      headers: { "content-type": "text/plain" },
    });
  }) as unknown as typeof fetch;
}

const NULL_SIGNER = () => ({ "x-internal-auth": "test" });

describe("IndicBARTLyricProvider", () => {
  it("posts to /v1/generate-lyric and wires the response back into a SongDocument", async () => {
    const fetched = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      // Echo each requested section back as a tiny stanza.
      const sections = (body.sections as Array<{ section_id: string }>).map(
        (s) => ({
          section_id: s.section_id,
          lyrics: `lyric for ${s.section_id}`,
          syllable_count_target: 16,
          syllable_count_actual: 16,
        }),
      );
      return new Response(
        JSON.stringify({
          body: sections.map((s) => s.lyrics).join("\n\n"),
          sections,
          model_version: "indicbart-2026-05-11",
          backend: "fake",
          decode_params: { num_beams: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const provider = new IndicBARTLyricProvider({
      baseUrl: "http://lyric-gen.test",
      signRequest: NULL_SIGNER,
      fetch: fetched,
    });

    const req: LyricsRequest = {
      language: "hi",
      style_family: "hindustani",
      prompt: "dawn on the river",
      target_duration_seconds: 60,
    };
    const doc = await provider.generate(req);

    expect(doc.language).toBe("hi");
    expect(doc.style_family).toBe("hindustani");
    // Hindustani template is [mukhda, antara]; both are text-bearing,
    // so both should have lyrics from the sidecar.
    const lyrical = doc.sections.filter((s) => s.lyrics);
    expect(lyrical.length).toBeGreaterThan(0);
    for (const s of lyrical) {
      expect(s.lyrics).toMatch(/^lyric for /);
      expect(s.script).toBe("devanagari");
    }
    expect((doc.metadata as Record<string, unknown>).neo_fm_lyrics_provider).toMatchObject({
      provider_id: "indicbart",
      sidecar_backend: "fake",
      sidecar_model_version: "indicbart-2026-05-11",
    });
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("uses devanagari script for Sanskrit requests", async () => {
    const fetched = fakeFetchOk({
      body: "vande mataram",
      sections: [
        {
          section_id: "shloka_verse-1",
          lyrics: "vande mataram",
          syllable_count_target: 16,
          syllable_count_actual: 4,
        },
        {
          section_id: "shloka_refrain-2",
          lyrics: "shubhraam jyotsnam",
          syllable_count_target: 16,
          syllable_count_actual: 6,
        },
      ],
      model_version: "stub",
      backend: "fake",
      decode_params: {},
    });
    const provider = new IndicBARTLyricProvider({
      baseUrl: "http://lyric-gen.test",
      signRequest: NULL_SIGNER,
      fetch: fetched,
    });
    const doc = await provider.generate({
      language: "sa",
      style_family: "sanskrit-shloka",
      target_duration_seconds: 60,
    });
    for (const s of doc.sections.filter((s) => s.lyrics)) {
      expect(s.script).toBe("devanagari");
    }
  });

  it("throws a structured error when the sidecar returns non-2xx", async () => {
    const provider = new IndicBARTLyricProvider({
      baseUrl: "http://lyric-gen.test",
      signRequest: NULL_SIGNER,
      fetch: fakeFetchErr(500, "boom"),
    });
    await expect(
      provider.generate({
        language: "en",
        style_family: "western",
        target_duration_seconds: 60,
      }),
    ).rejects.toThrow(/HTTP 500.*boom/);
  });
});

describe("FallbackLyricProvider", () => {
  it("uses primary when primary succeeds", async () => {
    const primary = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    const fallback = new IndicBARTLyricProvider({
      baseUrl: "http://nope",
      signRequest: NULL_SIGNER,
      fetch: vi.fn(async () => {
        throw new Error("should not have been called");
      }) as unknown as typeof fetch,
    });
    const provider = new FallbackLyricProvider({ primary, fallback });
    const doc = await provider.generate({
      language: "en",
      style_family: "western",
      target_duration_seconds: 60,
    });
    expect(
      (doc.metadata as { neo_fm_lyrics_provider: { provider_id: string } })
        .neo_fm_lyrics_provider.provider_id,
    ).toBe("public-library");
  });

  it("falls through to IndicBART when primary throws and enabled !== false", async () => {
    const primary = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    // Tyagaraja keerthana in English isn't on disk, so primary rejects.
    const fetched = fakeFetchOk({
      body: "...",
      sections: [
        {
          section_id: "pallavi-1",
          lyrics: "translated keerthana",
          syllable_count_target: 16,
          syllable_count_actual: 5,
        },
      ],
      model_version: "stub",
      backend: "fake",
      decode_params: {},
    });
    const fallback = new IndicBARTLyricProvider({
      baseUrl: "http://lyric-gen.test",
      signRequest: NULL_SIGNER,
      fetch: fetched,
    });
    const provider = new FallbackLyricProvider({ primary, fallback });
    const doc = await provider.generate({
      language: "en",
      style_family: "telugu-keerthana",
      target_duration_seconds: 60,
    });
    const ns = (doc.metadata as { neo_fm_lyrics_provider: Record<string, unknown> })
      .neo_fm_lyrics_provider;
    expect(ns.provider_id).toBe("indicbart");
    expect(ns.fell_back_from).toBe("public-library");
    expect(ns.fell_back_reason).toMatch(/language=en is not paired/);
  });

  it("re-throws when enabled=false", async () => {
    const primary = new PublicLyricsLibraryProvider({ rootDir: CORPUS });
    const fallback = new IndicBARTLyricProvider({
      baseUrl: "http://lyric-gen.test",
      signRequest: NULL_SIGNER,
      fetch: vi.fn(async () => {
        throw new Error("should not have been called");
      }) as unknown as typeof fetch,
    });
    const provider = new FallbackLyricProvider({
      primary,
      fallback,
      enabled: false,
    });
    await expect(
      provider.generate({
        language: "en",
        style_family: "telugu-keerthana",
        target_duration_seconds: 60,
      }),
    ).rejects.toThrow(/language=en is not paired/);
  });
});
