import { describe, expect, it } from "vitest";

import { parsePrefs, toggleMood } from "@/lib/station/prefs";

describe("station prefs", () => {
  it("returns null for missing or broken storage", () => {
    expect(parsePrefs(null)).toBeNull();
    expect(parsePrefs("{nope")).toBeNull();
  });

  it("drops unknown languages and moods, and caps moods at two", () => {
    expect(parsePrefs(JSON.stringify({ lang: "xx", moods: ["calm", "bogus", "joyful", "romantic"] }))).toEqual({
      lang: "",
      moods: ["calm", "joyful"],
    });
  });

  it("keeps a valid choice", () => {
    expect(parsePrefs(JSON.stringify({ lang: "ta", moods: ["devotional"] }))).toEqual({ lang: "ta", moods: ["devotional"] });
  });

  it("toggles moods with a two-mood limit", () => {
    expect(toggleMood([], "calm")).toEqual(["calm"]);
    expect(toggleMood(["calm", "joyful"], "romantic")).toEqual(["joyful", "romantic"]);
    expect(toggleMood(["calm", "joyful"], "calm")).toEqual(["joyful"]);
  });
});
