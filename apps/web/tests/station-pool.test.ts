import { describe, expect, it, vi } from "vitest";

import { rowToTrack } from "../lib/station/pool";

describe("rowToTrack", () => {
  it("merges mood, theme, genre, raga and tempo band into lowercase unique tags", () => {
    const t = rowToTrack({
      id: "x", title: " Janmadin ", audio_path: "pool/a.mp3", duration_seconds: 60, language: "hi",
      genre: "Bollywood", raga: null, mood: ["Upbeat"], theme: ["birthday", "upbeat"], tempo_band: "fast",
    });
    expect(t.tags.sort()).toEqual(["birthday", "bollywood", "fast", "upbeat"]);
    expect(t.title).toBe("Janmadin");
  });
  it("names untitled tracks by language and genre", () => {
    const base = { id: "x", title: null, audio_path: "a", duration_seconds: null, raga: null, mood: null, theme: null, tempo_band: null };
    expect(rowToTrack({ ...base, language: "kn", genre: "light-classical" }).title).toBe("Kannada light classical");
    expect(rowToTrack({ ...base, language: "ta", genre: null }).title).toBe("Tamil");
  });
});

describe("rowToTrack tagger columns", () => {
  const base = { id: "x", title: "t", audio_path: "a", duration_seconds: 60, language: "hi", genre: null, raga: null, mood: null, theme: null, tempo_band: null };
  it("carries energy and daypart when present", () => {
    const t = rowToTrack({ ...base, energy: "low", daypart: ["night", "dusk"] });
    expect(t.energy).toBe("low");
    expect(t.daypart).toEqual(["night", "dusk"]);
  });
  it("defaults to null and empty when the columns are absent or odd", () => {
    expect(rowToTrack(base)).toMatchObject({ energy: null, daypart: [] });
    expect(rowToTrack({ ...base, energy: "extreme", daypart: null })).toMatchObject({ energy: null, daypart: [] });
  });
});

describe("loadPool", () => {
  it("reads admitted rows through the client (regression: a detached .from threw and emptied the station)", async () => {
    vi.resetModules();
    const row = { id: "x", title: "t", audio_path: "a", duration_seconds: 60, language: "hi", genre: null, raga: null, mood: null, theme: null, tempo_band: null, energy: "mid", daypart: ["night"] };
    vi.doMock("@/lib/supabase/server", () => ({
      createServiceRoleClient: () => ({
        marker: true,
        from(this: { marker?: boolean }) {
          if (!this?.marker) throw new TypeError("detached from");
          return { select: () => ({ eq: async () => ({ data: [row], error: null }) }) };
        },
      }),
    }));
    const { loadPool } = await import("../lib/station/pool");
    expect(await loadPool()).toHaveLength(1);
    vi.doUnmock("@/lib/supabase/server");
  });
});
