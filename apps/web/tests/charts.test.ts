import { describe, expect, it } from "vitest";

import {
  normalizeChartLang,
  pickSongOfTheDay,
  utcDayNumber,
  type ChartSong,
} from "@/lib/charts/pick";

const song = (id: string): ChartSong => ({
  public_id: id,
  title: id,
  language: "hi",
  style_family: "western",
  likes: 1,
  listeners: 1,
  shares: 0,
  score: 5,
});

describe("charts", () => {
  it("normalizes the chart language param", () => {
    expect(normalizeChartLang("kn")).toBe("kn");
    expect(normalizeChartLang("xx")).toBeNull();
    expect(normalizeChartLang(undefined)).toBeNull();
    expect(normalizeChartLang("kn' or 1=1")).toBeNull();
  });

  it("song of the day is stable within a UTC day and rotates across days", () => {
    const chart = ["a", "b", "c", "d", "e", "f"].map(song);
    const morning = new Date("2026-10-12T00:05:00Z");
    const night = new Date("2026-10-12T23:55:00Z");
    expect(pickSongOfTheDay(chart, morning)).toBe(pickSongOfTheDay(chart, night));
    const seen = new Set<string>();
    for (let d = 0; d < 5; d++) {
      const day = new Date(morning.getTime() + d * 86_400_000);
      seen.add(pickSongOfTheDay(chart, day)!.public_id);
    }
    expect(seen.size).toBe(5);
    expect(seen.has("f")).toBe(false); // only the top 5 are eligible
  });

  it("returns null for an empty chart", () => {
    expect(pickSongOfTheDay([])).toBeNull();
    expect(utcDayNumber(new Date("1970-01-02T00:00:00Z"))).toBe(1);
  });
});
