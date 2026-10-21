import { describe, expect, it } from "vitest";

import { buildWeek, weekEnabled, type WeekSignal, type WeekTrack } from "../lib/station/week";

// 2026-10-21 12:00 IST
const NOW = Date.parse("2026-10-21T06:30:00Z");
const ago = (days: number, hours = 0) => new Date(NOW - days * 86_400_000 - hours * 3_600_000).toISOString();
const sig = (trackId: string, kind: string, createdAt: string, positionMs: number | null = null): WeekSignal => ({ trackId, kind, createdAt, positionMs });
const TRACKS: Record<string, WeekTrack> = {
  a: { title: "Morning raga", language: "hi", genre: "classical", mood: ["calm", "devotional"], durationSeconds: 180 },
  b: { title: null, language: "kn", genre: "bhavageethe", mood: ["nostalgic"], durationSeconds: 120 },
  c: { title: "Beats", language: "hi", genre: "pop", mood: ["energetic"], durationSeconds: null },
};

describe("buildWeek", () => {
  it("is empty with no signals in the window and ignores older ones", () => {
    expect(buildWeek([], TRACKS, NOW).empty).toBe(true);
    expect(buildWeek([sig("a", "finish", ago(8))], TRACKS, NOW).empty).toBe(true);
  });

  it("counts signals, distinct tracks and minutes listened", () => {
    const w = buildWeek(
      [
        sig("a", "play", ago(0, 1)), sig("a", "finish", ago(0, 1)),
        sig("b", "play", ago(1)), sig("b", "skip", ago(1), 60_000),
        sig("c", "play", ago(2)), sig("c", "finish", ago(2)),
        sig("a", "like", ago(0, 1)),
      ],
      TRACKS,
      NOW,
    );
    expect(w).toMatchObject({ plays: 3, finishes: 2, skips: 1, likes: 1, distinctTracks: 3 });
    // a finished 180 s + b skipped at 60 s + c finished at the 150 s default = 390 s
    expect(w.minutes).toBe(7);
  });

  it("ranks languages and moods by what was finished, liked, replayed or shared, not by plays or skips", () => {
    const w = buildWeek(
      [
        sig("b", "play", ago(0)), sig("b", "play", ago(0)), sig("b", "play", ago(0)), sig("b", "skip", ago(0)),
        sig("a", "finish", ago(1)), sig("a", "like", ago(1)),
      ],
      TRACKS,
      NOW,
    );
    expect(w.languages[0]).toEqual({ language: "hi", weight: 3 });
    expect(w.languages.find((l) => l.language === "kn")).toBeUndefined();
    expect(w.moods.map((m) => m.mood)).toEqual(["calm", "devotional"]);
    expect(w.favourite).toMatchObject({ trackId: "a", title: "Morning raga", language: "hi" });
  });

  it("counts active days in India time and the streak ending today or yesterday", () => {
    const three = buildWeek([sig("a", "play", ago(0)), sig("a", "play", ago(1)), sig("a", "play", ago(2)), sig("a", "play", ago(5))], TRACKS, NOW);
    expect(three).toMatchObject({ activeDays: 4, streak: 3 });
    const fromYesterday = buildWeek([sig("a", "play", ago(1)), sig("a", "play", ago(2))], TRACKS, NOW);
    expect(fromYesterday.streak).toBe(2);
    const broken = buildWeek([sig("a", "play", ago(3))], TRACKS, NOW);
    expect(broken.streak).toBe(0);
  });

  it("copes with signals for tracks that left the pool", () => {
    const w = buildWeek([sig("gone", "finish", ago(0)), sig("gone", "like", ago(0))], TRACKS, NOW);
    expect(w).toMatchObject({ finishes: 1, likes: 1, favourite: null, languages: [] });
    expect(w.minutes).toBe(3); // default 150 s
  });

  it("is off unless STATION_WEEK=1", () => {
    expect(weekEnabled()).toBe(false);
  });
});
