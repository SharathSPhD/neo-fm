import { describe, expect, it } from "vitest";

import {
  avatarColors,
  avatarInitial,
  groupByLanguage,
  profileBlurb,
  profileStats,
  type ProfileSong,
} from "@/lib/profile/summary";

const song = (id: string, language: string, published_at: string | null, like_count = 0): ProfileSong => ({
  id,
  public_id: id,
  published_at,
  title: id,
  language,
  style_family: "western",
  like_count,
});

describe("profile summary", () => {
  const songs = [
    song("a", "hi", "2026-10-01T00:00:00Z", 2),
    song("b", "kn", "2026-10-03T00:00:00Z", 1),
    song("c", "kn", "2026-10-05T00:00:00Z"),
    song("d", "ta", null),
  ];

  it("groups by language, biggest first, newest first inside a group", () => {
    const g = groupByLanguage(songs);
    expect(g.map((x) => x.language)).toEqual(["kn", "ta", "hi"]);
    expect(g[0]!.songs.map((s) => s.id)).toEqual(["c", "b"]);
  });

  it("breaks size ties by launch language order and keeps unknown codes last", () => {
    const g = groupByLanguage([song("x", "zz", null), song("y", "hi", null), song("z", "ta", null)]);
    expect(g.map((x) => x.language)).toEqual(["ta", "hi", "zz"]);
  });

  it("counts songs, distinct languages and likes", () => {
    expect(profileStats(songs)).toEqual({ songs: 4, languages: 3, likes: 3 });
    expect(profileStats([])).toEqual({ songs: 0, languages: 0, likes: 0 });
  });

  it("writes a blurb for 0, 1, few and many languages", () => {
    expect(profileBlurb("s", { songs: 0, languages: 0, likes: 0 }, [])).toBe("@s is on neo-fm.");
    expect(profileBlurb("s", { songs: 1, languages: 1, likes: 0 }, ["Tamil"])).toBe(
      "@s has made 1 song in Tamil on neo-fm.",
    );
    expect(profileBlurb("s", { songs: 5, languages: 2, likes: 0 }, ["Tamil", "Hindi"])).toBe(
      "@s has made 5 songs in Tamil, Hindi on neo-fm.",
    );
    expect(profileBlurb("s", { songs: 9, languages: 4, likes: 0 }, ["a", "b", "c", "d"])).toBe(
      "@s has made 9 songs in 4 languages on neo-fm.",
    );
  });

  it("avatarInitial upper-cases the first character and tolerates empties", () => {
    expect(avatarInitial("sharath")).toBe("S");
    expect(avatarInitial("@neo")).toBe("N");
    expect(avatarInitial("")).toBe("?");
  });

  it("avatarColors is deterministic hex that satori can parse", () => {
    const a = avatarColors("sharath");
    expect(a).toEqual(avatarColors("sharath"));
    expect(a.from).toMatch(/^#[0-9a-f]{6}$/);
    expect(a.to).toMatch(/^#[0-9a-f]{6}$/);
    expect(avatarColors("someone-else")).not.toEqual(a);
  });
});
