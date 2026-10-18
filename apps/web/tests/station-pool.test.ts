import { describe, expect, it } from "vitest";

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
  it("falls back to Untitled", () => {
    expect(rowToTrack({ id: "x", title: null, audio_path: "a", duration_seconds: null, language: "ta", genre: null, raga: null, mood: null, theme: null, tempo_band: null }).title).toBe("Untitled");
  });
});
