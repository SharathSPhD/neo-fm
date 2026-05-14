/**
 * Schema-shape tests for the public API contract. These mirror what the
 * route handler does on the boundary -- they protect against accidental
 * schema relaxations.
 */
import { describe, expect, it } from "vitest";

import {
  CreateSongRequestSchema,
  ListSongsQuerySchema,
  SongIdSchema,
} from "../../lib/api/song-schemas";

const valid_doc = {
  language: "en",
  style_family: "western",
  target_duration_seconds: 30,
  sections: [
    { id: "verse-1", type: "verse", target_seconds: 15 },
    { id: "chorus-1", type: "chorus", target_seconds: 15 },
  ],
} as const;

describe("CreateSongRequestSchema", () => {
  it("accepts a song_document branch", () => {
    const res = CreateSongRequestSchema.safeParse({ song_document: valid_doc });
    expect(res.success).toBe(true);
  });

  it("rejects when both branches are supplied", () => {
    const res = CreateSongRequestSchema.safeParse({
      song_document: valid_doc,
      prompt: "x",
    });
    expect(res.success).toBe(false);
  });

  it("rejects when neither branch is supplied", () => {
    const res = CreateSongRequestSchema.safeParse({});
    expect(res.success).toBe(false);
  });

  it("prompt branch requires language + style_family + target_duration_seconds", () => {
    const res = CreateSongRequestSchema.safeParse({ prompt: "happy" });
    expect(res.success).toBe(false);
  });

  it("accepts a complete prompt branch", () => {
    const res = CreateSongRequestSchema.safeParse({
      prompt: "happy",
      language: "en",
      style_family: "western",
      target_duration_seconds: 30,
    });
    expect(res.success).toBe(true);
  });
});

describe("ListSongsQuerySchema", () => {
  it("coerces and defaults limit", () => {
    const res = ListSongsQuerySchema.parse({});
    expect(res.limit).toBe(25);
  });
  it("rejects limit > 100", () => {
    expect(() => ListSongsQuerySchema.parse({ limit: 1000 })).toThrow();
  });
});

describe("SongIdSchema", () => {
  it("requires UUID", () => {
    expect(SongIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(SongIdSchema.safeParse("00000000-0000-0000-0000-000000000001").success).toBe(true);
  });
});
