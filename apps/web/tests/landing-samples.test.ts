import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({}) }));

import { HERO_LANGS } from "@/lib/landing/langs";
import { pickSamples, previewLines, type SongRow } from "@/lib/landing/samples";
import { MIN_SONGS_TO_SHOW, shouldShowStats } from "@/lib/landing/stats";

describe("previewLines", () => {
  it("skips tags, headings, bold markers, titles and blanks", () => {
    const lines = previewLines([
      { type: "verse", lyrics: "**Title:** x\n[Hook]\n## Verse\n\nಅಂಗಳದ ತುಳಸಿ\n**ಅಮ್ಮನ ಲಾಲಿ**\nಮೂರನೇ\nನಾಲ್ಕನೇ\nಐದನೇ" },
    ]);
    expect(lines).toEqual(["ಅಂಗಳದ ತುಳಸಿ", "ಅಮ್ಮನ ಲಾಲಿ", "ಮೂರನೇ", "ನಾಲ್ಕನೇ"]);
  });
  it("ignores instrumental sections and null input", () => {
    expect(previewLines([{ type: "instrumental", lyrics: "la la" }])).toEqual([]);
    expect(previewLines(null)).toEqual([]);
  });
});

const row = (id: string, language: string, lyrics: string, title: string | null = "T"): SongRow => ({
  public_id: id,
  song_documents: { title, language, document_json: { sections: [{ type: "verse", lyrics }] } },
});

describe("pickSamples", () => {
  it("returns one entry per hero language, newest song first, idea always present", () => {
    const s = pickSamples([row("new", "hi", "नया"), row("old", "hi", "पुराना"), row("x", "en", "english")]);
    expect(s.map((x) => x.code)).toEqual(HERO_LANGS.map((l) => l.code));
    expect(s.find((x) => x.code === "hi")?.song?.publicId).toBe("new");
    expect(s.find((x) => x.code === "ta")?.song).toBeNull();
    for (const x of s) expect(x.idea.length).toBeGreaterThan(5);
  });
  it("skips songs with no usable lyric lines and defaults the title", () => {
    const s = pickSamples([row("a", "kn", "[Hook]"), row("b", "kn", "ಸಾಲು", " ")]);
    expect(s.find((x) => x.code === "kn")?.song).toEqual({ publicId: "b", title: "Untitled", lines: ["ಸಾಲು"] });
  });
});

describe("shouldShowStats", () => {
  it("hides small or null communities", () => {
    expect(shouldShowStats(null)).toBe(false);
    expect(shouldShowStats({ songs: MIN_SONGS_TO_SHOW - 1, languages: 5 })).toBe(false);
    expect(shouldShowStats({ songs: MIN_SONGS_TO_SHOW, languages: 1 })).toBe(false);
    expect(shouldShowStats({ songs: MIN_SONGS_TO_SHOW, languages: 3 })).toBe(true);
  });
});
