import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildRecap, currentMonth, extractMoods, monthRange, previousMonth, type RecapSong } from "@/lib/recap/compute";
import { renderRecapStory } from "@/lib/recap/image";
import { moodLabel } from "@/lib/recap/moods";
import { RECAP_STRINGS, monthLabel } from "@/lib/recap/strings";
import { UI_LANGS } from "@/lib/i18n/ui-strings";

const song = (id: string, over: Partial<RecapSong> = {}): RecapSong => ({
  id, title: id, language: "hi", style_family: "hindustani", created_at: "2026-10-03T00:00:00Z", moods: [], ...over,
});

describe("month ranges (IST)", () => {
  const now = new Date("2026-10-12T10:00:00Z");
  it("starts at midnight IST", () => {
    const r = monthRange("2026-10", now)!;
    expect(r.start).toBe("2026-09-30T18:30:00.000Z");
    expect(r.end).toBe("2026-10-31T18:30:00.000Z");
  });
  it("rejects bad, ancient and future months", () => {
    expect(monthRange("2026-13", now)).toBeNull();
    expect(monthRange("26-10", now)).toBeNull();
    expect(monthRange("2019-01", now)).toBeNull();
    expect(monthRange("2026-11", now)).toBeNull();
  });
  it("derives current and previous month in IST", () => {
    expect(currentMonth(new Date("2026-09-30T20:00:00Z"))).toBe("2026-10");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});

describe("buildRecap", () => {
  it("counts languages, moods and picks the top song (likes weigh 3x a listen)", () => {
    const r = buildRecap({
      songs: [song("a", { moods: ["calm"] }), song("b", { language: "kn", moods: ["calm", "joyful"] }), song("c", { language: "kn" })],
      likes: { a: 1, b: 0, ghost: 99 },
      listeners: { a: 0, b: 2, c: 1 },
      collectionsCreated: 2,
      songsCollected: 5,
    });
    expect(r.songs).toBe(3);
    expect(r.languages).toEqual([{ code: "kn", count: 2 }, { code: "hi", count: 1 }]);
    expect(r.moods[0]).toEqual({ mood: "calm", count: 2 });
    expect(r.topSong?.id).toBe("a");
    expect(r.likes).toBe(1);
    expect(r.listens).toBe(3);
    expect(r.collections).toEqual({ created: 2, added: 5 });
  });
  it("has no top song when nothing was reacted to", () => {
    expect(buildRecap({ songs: [song("a")], likes: {}, listeners: {}, collectionsCreated: 0, songsCollected: 0 }).topSong).toBeNull();
  });
  it("reads mood tags from sections and ignores junk", () => {
    expect(extractMoods({ sections: [{ tags: ["mood:Calm", "raga:x", 5] }, { tags: ["mood:calm", "mood:<b>"] }, null] })).toEqual(["calm"]);
    expect(extractMoods(null)).toEqual([]);
  });
});

describe("mood labels", () => {
  it("localizes known moods and falls back to the stored word", () => {
    expect(moodLabel("calm", "hi")).toBe("शांत");
    expect(moodLabel("Calm", "kn")).toBe("ಶಾಂತ");
    expect(moodLabel("calm", "en")).toBe("calm");
    expect(moodLabel("zesty", "ta")).toBe("zesty");
    expect(moodLabel("constructor", "ta")).toBe("constructor");
  });
});

describe("strings", () => {
  it("has every field in every UI language", () => {
    for (const l of UI_LANGS) for (const v of Object.values(RECAP_STRINGS[l])) expect(v.length).toBeGreaterThan(1);
  });
  it("formats the month with Latin digits", () => {
    expect(monthLabel("2026-10", "en")).toMatch(/October 2026/);
    expect(monthLabel("2026-10", "bn")).toMatch(/2026/);
  });
});

// UPDATE_SHARE_FIXTURES=1 writes PNGs to tests/fixtures/recap/ for review.
describe("recap story render", () => {
  const recap = buildRecap({
    songs: [song("a", { title: "बरसात की रात", moods: ["calm", "joyful"] }), song("b", { language: "kn" }), song("c", { language: "ta" })],
    likes: { a: 12 }, listeners: { a: 140, b: 3 }, collectionsCreated: 2, songsCollected: 4,
  });
  // Each render rasterises a PNG with fonts (3-4 s alone); under a parallel full-suite run it exceeds vitest's 5 s default.
  const RENDER_TIMEOUT_MS = 30_000;
  for (const lang of UI_LANGS) {
    it(`renders ${lang}`, { timeout: RENDER_TIMEOUT_MS }, async () => {
      const res = await renderRecapStory({ recap, month: "2026-10", lang });
      const png = Buffer.from(await res.arrayBuffer());
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      if (process.env.UPDATE_SHARE_FIXTURES) {
        const dir = join(process.cwd(), "tests/fixtures/recap");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${lang}.png`), png);
      }
    });
  }
  it("renders the empty month", { timeout: RENDER_TIMEOUT_MS }, async () => {
    const res = await renderRecapStory({ recap: buildRecap({ songs: [], likes: {}, listeners: {}, collectionsCreated: 0, songsCollected: 0 }), month: "2026-10", lang: "ta" });
    expect(Buffer.from(await res.arrayBuffer()).subarray(1, 4).toString()).toBe("PNG");
  });
});
