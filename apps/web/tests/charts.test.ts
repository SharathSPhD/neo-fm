import { readFileSync } from "node:fs";
import { join } from "node:path";

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

describe("chart_songs anti-gaming guards (migration text)", () => {
  // The function is validated against a scratch Postgres by hand; this just
  // stops a later edit from silently dropping a guard.
  const sql = readFileSync(
    join(process.cwd(), "../../infra/supabase/migrations/0079_discovery_charts.sql"),
    "utf8",
  );
  it.each([
    ["verified email", /au\.email_confirmed_at is not null/],
    ["account age", /au\.created_at <= now\(\) - interval '3 days'/],
    ["trust weight", /case when u\.tier::text <> 'free'/],
    ["per-account cap on songs", /user_rank <= 10/],
    ["owner excluded", /s\.user_id <> e\.owner_id/],
    ["distinct trusted floor", /s\.engaged >= 5/],
    ["abuse backstop", /song_reports r where r\.job_id = j\.id\) < 3/],
    ["service role only", /grant execute on function public\.chart_songs\(text, int, int\) to service_role/],
  ])("keeps the %s guard", (_name, re) => {
    expect(sql).toMatch(re);
  });
  it("is not executable by end users", () => {
    expect(sql).toMatch(/revoke all on function public\.chart_songs\(text, int, int\) from public, anon, authenticated/);
  });
});
