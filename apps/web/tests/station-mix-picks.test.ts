import { describe, expect, it } from "vitest";

import { cleanMix, mixActive, mixParam, setMixWeight, toggleMixLang } from "@/lib/station/mix-picks";
import { parsePrefs } from "@/lib/station/prefs";

describe("station mix picks", () => {
  it("adds at even weight, removes on a second tap and keeps at most three (the oldest drops)", () => {
    let p = toggleMixLang([], "ta");
    expect(p).toEqual([{ lang: "ta", weight: 2 }]);
    p = toggleMixLang(toggleMixLang(toggleMixLang(p, "hi"), "kn"), "te");
    expect(p.map((x) => x.lang)).toEqual(["hi", "kn", "te"]);
    expect(toggleMixLang(p, "kn").map((x) => x.lang)).toEqual(["hi", "te"]);
  });

  it("is a mix only with two or more languages, and sends percentages the queue accepts", () => {
    expect(mixActive([{ lang: "ta", weight: 2 }])).toBe(false);
    expect(mixParam([{ lang: "ta", weight: 2 }])).toBeNull();
    const two = setMixWeight(toggleMixLang(toggleMixLang([], "ta"), "hi"), "ta", 3);
    expect(mixParam(two)).toBe("ta:60,hi:40");
    expect(mixParam(toggleMixLang(toggleMixLang(toggleMixLang([], "ta"), "hi"), "kn"))).toBe("ta:33,hi:33,kn:33");
  });

  it("cleans saved picks: offered languages, valid weights, no duplicates, max three", () => {
    const raw = [
      { lang: "ta", weight: 3 }, { lang: "ta", weight: 1 }, { lang: "xx", weight: 2 }, { lang: "hi", weight: 9 },
      { lang: "kn", weight: 1 }, { lang: "te", weight: 2 }, { lang: "bn", weight: 2 },
    ];
    expect(cleanMix(raw, ["ta", "hi", "kn", "te", "bn"])).toEqual([{ lang: "ta", weight: 3 }, { lang: "kn", weight: 1 }, { lang: "te", weight: 2 }]);
    expect(cleanMix("nope", ["ta"])).toEqual([]);
  });

  it("round-trips through saved prefs and leaves old prefs without a mix key", () => {
    const saved = JSON.stringify({ lang: "", moods: ["calm"], mix: [{ lang: "ta", weight: 3 }, { lang: "hi", weight: 1 }] });
    expect(parsePrefs(saved)?.mix).toEqual([{ lang: "ta", weight: 3 }, { lang: "hi", weight: 1 }]);
    expect(parsePrefs(JSON.stringify({ lang: "ta", moods: [] }))).toEqual({ lang: "ta", moods: [] });
  });
});
