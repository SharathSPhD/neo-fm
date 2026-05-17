/**
 * Unit tests for `lib/song/fork.ts` — the shared zod body schema used
 * by both /api/songs/[id]/variation and /api/songs/[id]/remix.
 */
import { describe, expect, it } from "vitest";

import { ForkSongBodySchema, parseForkBody } from "../../lib/song/fork";

describe("ForkSongBodySchema", () => {
  it("accepts an empty body", () => {
    expect(ForkSongBodySchema.parse({})).toEqual({});
  });

  it("accepts a full body with every knob set", () => {
    const body = {
      distance: 80,
      tempo_bpm: 120,
      key_override: "F#m",
      raga_override: { name: "kalyani", system: "carnatic" as const },
      voice_id: "kn-female-warm-01",
      section_ids: ["v1", "c1"],
      title: "Streetlights, slower",
    };
    expect(ForkSongBodySchema.parse(body)).toEqual(body);
  });

  it("rejects distance > 100", () => {
    expect(() => ForkSongBodySchema.parse({ distance: 101 })).toThrow();
  });

  it("rejects tempo_bpm out of range", () => {
    expect(() => ForkSongBodySchema.parse({ tempo_bpm: 10 })).toThrow();
    expect(() => ForkSongBodySchema.parse({ tempo_bpm: 999 })).toThrow();
  });

  it("rejects an unknown raga system", () => {
    expect(() =>
      ForkSongBodySchema.parse({
        raga_override: { name: "x", system: "atonal" as never },
      }),
    ).toThrow();
  });

  it("rejects > 32 section ids", () => {
    const ids = Array.from({ length: 33 }, (_, i) => `s${i}`);
    expect(() => ForkSongBodySchema.parse({ section_ids: ids })).toThrow();
  });

  it("rejects unknown top-level fields (strict mode)", () => {
    expect(() =>
      ForkSongBodySchema.parse({ distance: 10, evil_field: "x" }),
    ).toThrow();
  });
});

describe("parseForkBody", () => {
  it("treats null / undefined / empty string as an empty body", () => {
    expect(parseForkBody(null)).toEqual({});
    expect(parseForkBody(undefined)).toEqual({});
    expect(parseForkBody("")).toEqual({});
  });

  it("treats {} as an empty body without throwing", () => {
    expect(parseForkBody({})).toEqual({});
  });

  it("passes through a populated body", () => {
    expect(parseForkBody({ distance: 50 })).toEqual({ distance: 50 });
  });
});
