import { describe, expect, it } from "vitest";

import { rankTracks, type PoolTrack, type StationSignal } from "../../lib/station/rank";
import { hostLine } from "../../lib/station/host";
import { daypartOf, stationTasteEnabled, tasteBias, tasteHostNote } from "../../lib/station/taste-bias";

const track = (id: string, language: string, tags: string[], extra: Partial<PoolTrack> = {}): PoolTrack => ({ id, language, tags, ...extra });
const fixed = () => 0;

describe("stationTasteEnabled", () => {
  it("is off unless STATION_TASTE=1", () => {
    expect(stationTasteEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(stationTasteEnabled({ NODE_ENV: "test", STATION_TASTE: "0" })).toBe(false);
    expect(stationTasteEnabled({ NODE_ENV: "test", STATION_TASTE: "1" })).toBe(true);
  });
});

describe("daypartOf", () => {
  it("maps hours to the four dayparts", () => {
    expect([6, 13, 19, 23, 2].map(daypartOf)).toEqual(["morning", "afternoon", "evening", "night", "night"]);
  });
});

describe("tasteBias", () => {
  it("favours tracks matching saved genres and moods", () => {
    const bias = tasteBias({ v: 1, genres: ["carnatic"], moods: ["calm"] }, { hour: 10 });
    expect(bias(track("a", "ta", ["carnatic", "calm"]))).toBeGreaterThan(bias(track("b", "ta", ["rock"])));
    expect(bias(track("b", "ta", ["rock"]))).toBe(0);
  });

  it("uses the mood wanted at this time of day", () => {
    const taste = { v: 1 as const, daypart_moods: { morning: "calm" as const, night: "romantic" as const } };
    const t = track("a", "hi", ["calm"]);
    expect(tasteBias(taste, { hour: 8 })(t)).toBeGreaterThan(0);
    expect(tasteBias(taste, { hour: 23 })(t)).toBe(0);
  });

  it("applies the language mix only when the listener did not pick a language, and never to instrumentals", () => {
    const taste = { v: 1 as const, languages: ["kn" as const] };
    const kn = track("a", "kn", []);
    expect(tasteBias(taste, { hour: 10 })(kn)).toBeGreaterThan(0);
    expect(tasteBias(taste, { hour: 10, languageLocked: true })(kn)).toBe(0);
    expect(tasteBias(taste, { hour: 10 })(track("i", "kn", [], { kind: "instrumental" }))).toBe(0);
  });

  it("matches energy and stays under the total cap", () => {
    const taste = { v: 1 as const, genres: ["a", "b", "c", "d"] as never, energy: "high" as const, languages: ["hi" as const], daypart_moods: { morning: "joyful" as const } };
    const t = track("a", "hi", ["a", "b", "c", "d", "joyful"], { energy: "high" });
    expect(tasteBias(taste, { hour: 8 })(t)).toBeLessThanOrEqual(2.5);
  });
});

describe("rankTracks with a taste prior", () => {
  const pool = [track("rock", "hi", ["rock"]), track("carn", "hi", ["carnatic"])];
  const prior = tasteBias({ v: 1, genres: ["carnatic"] }, { hour: 10 });

  it("breaks a tie toward the saved taste", () => {
    expect(rankTracks(pool, [], { random: fixed, prior })[0]!.id).toBe("carn");
  });

  it("is unchanged without a prior", () => {
    expect(rankTracks(pool, [], { random: fixed }).map((t) => t.id)).toEqual(["rock", "carn"]);
  });

  it("is overridden by the listener's own behaviour", () => {
    const signals: StationSignal[] = [
      { trackId: "rock", kind: "like", ageMs: 1000 },
      { trackId: "carn", kind: "skip", ageMs: 1000 },
    ];
    expect(rankTracks(pool, signals, { random: fixed, prior })[0]!.id).toBe("rock");
  });
});

describe("tasteHostNote and hostLine", () => {
  const taste = { v: 1 as const, moods: ["calm" as const], daypart_moods: { evening: "romantic" as const } };

  it("names a saved mood the track really carries, preferring the daypart mood", () => {
    expect(tasteHostNote(taste, { tags: ["calm", "romantic"] }, "en", 19)).toBe("For your romantic mood.");
    expect(tasteHostNote(taste, { tags: ["calm"] }, "en", 19)).toBe("For your calm mood.");
  });

  it("uses the translated mood label and stays silent when nothing matches or the language has no template", () => {
    expect(tasteHostNote(taste, { tags: ["calm"] }, "hi", 10)).toBe("आपके शांत मूड के लिए।");
    expect(tasteHostNote(taste, { tags: ["rock"] }, "en", 10)).toBeNull();
    expect(tasteHostNote(taste, { tags: ["calm"] }, "pa", 10)).toBeNull();
  });

  it("is appended to the host line only when given", () => {
    const base = hostLine({ hour: 19, language: "en", seed: "x" });
    expect(hostLine({ hour: 19, language: "en", seed: "x", note: null })).toBe(base);
    expect(hostLine({ hour: 19, language: "en", seed: "x", note: "For your calm mood." })).toBe(`${base} For your calm mood.`);
  });
});
