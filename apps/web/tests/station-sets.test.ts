import { describe, expect, it, vi } from "vitest";

import { canSetVolume, rampVolume } from "../lib/station/fade";
import type { PoolTrack } from "../lib/station/rank";
import { arrangeSets, crossfadeFor, instrumentalPolicy, setsEnabled } from "../lib/station/sets";

const vocal = (id: string, language: string, tags: string[] = [], durationSeconds = 60): PoolTrack => ({ id, language, tags, durationSeconds, kind: "vocal" });
const instr = (id: string, tags: string[] = [], durationSeconds = 150): PoolTrack => ({ id, language: "zxx", tags, durationSeconds, kind: "instrumental" });

const LANGS = ["hi", "ta", "te", "kn", "bn"];
const mixedVocals = (n: number) => Array.from({ length: n }, (_, i) => vocal(`v${i}`, LANGS[Math.floor(i / 3) % LANGS.length]!));
const manyVocals = (n: number) => Array.from({ length: n }, (_, i) => vocal(`v${i}`, LANGS[i % LANGS.length]!));
const instruments = (n: number, tags: string[] = []) => Array.from({ length: n }, (_, i) => instr(`i${i}`, tags));

/** Maximal runs of one kind and, for vocals, one language: what the listener hears without a change of feel. */
function runs(tracks: PoolTrack[]): number[] {
  const out: number[] = [];
  let prev: PoolTrack | null = null;
  for (const t of tracks) {
    const secs = t.durationSeconds ?? 60;
    if (prev && prev.kind === t.kind && prev.language === t.language) out[out.length - 1]! += secs;
    else out.push(secs);
    prev = t;
  }
  return out;
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const share = (tracks: PoolTrack[]) => {
  const total = tracks.reduce((n, t) => n + (t.durationSeconds ?? 60), 0);
  return tracks.filter((t) => t.kind === "instrumental").reduce((n, t) => n + (t.durationSeconds ?? 150), 0) / total;
};

describe("arrangeSets", () => {
  it("groups three same-language vocals per block and records the set", () => {
    const { tracks, sets } = arrangeSets(manyVocals(15), [], { hour: 10, limit: 9 });
    expect(tracks).toHaveLength(9);
    for (let b = 0; b < 3; b++) {
      const block = tracks.slice(b * 3, b * 3 + 3);
      expect(new Set(block.map((t) => t.language)).size).toBe(1);
      expect(block.map((t) => sets.get(t.id)?.index)).toEqual([0, 1, 2]);
      expect(new Set(block.map((t) => sets.get(t.id)?.id)).size).toBe(1);
    }
  });

  it("changes language between blocks so no more than three of one language play in a row", () => {
    const { tracks } = arrangeSets(manyVocals(30), [], { hour: 10, limit: 18 });
    let run = 1;
    for (let i = 1; i < tracks.length; i++) {
      run = tracks[i]!.language === tracks[i - 1]!.language ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(3);
    }
  });

  it("keeps a locked language in sets of its own language", () => {
    const hi = Array.from({ length: 9 }, (_, i) => vocal(`h${i}`, "hi"));
    const { tracks, sets } = arrangeSets(hi, [], { hour: 10, limit: 9 });
    expect(tracks).toHaveLength(9);
    expect(sets.size).toBe(9);
  });

  it("shrinks a block to what the language has, and never makes a one-track set", () => {
    const pool = [vocal("a", "hi"), vocal("b", "hi"), vocal("c", "ta")];
    const { tracks, sets } = arrangeSets(pool, [], { hour: 10, limit: 3 });
    expect(tracks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(sets.get("a")?.size).toBe(2);
    expect(sets.has("c")).toBe(false);
  });

  it("holds the instrumental share to the daypart cap and lets the first one in only when it fits", () => {
    const { tracks } = arrangeSets(mixedVocals(30), instruments(5), { hour: 10, limit: 10 });
    const firstInstr = tracks.findIndex((t) => t.kind === "instrumental");
    // 150 s after two blocks would be 29%, over the 25% morning cap; after three blocks it is 22%.
    expect(firstInstr).toBe(9);
    expect(share(tracks)).toBeLessThanOrEqual(instrumentalPolicy("morning").cap);
  });

  it("allows more instrumentals at midday and night than in the morning", () => {
    expect(instrumentalPolicy("midday").cap).toBeGreaterThan(instrumentalPolicy("morning").cap);
    expect(instrumentalPolicy("night").cap).toBeGreaterThan(instrumentalPolicy("evening").cap);
  });

  it("keeps instrumentals out of devotional dawn sets, but not out of the same pool at other hours", () => {
    const devotional = Array.from({ length: 12 }, (_, i) => vocal(`d${i}`, "hi", ["devotional"]));
    const dawn = arrangeSets(devotional, instruments(3), { hour: 6, limit: 12 });
    expect(dawn.tracks.some((t) => t.kind === "instrumental")).toBe(false);
    const morning = arrangeSets(devotional, instruments(3), { hour: 10, limit: 12 });
    expect(morning.tracks.some((t) => t.kind === "instrumental")).toBe(true);
    const calmAtDawn = arrangeSets(mixedVocals(12), instruments(3), { hour: 6, limit: 12 });
    expect(calmAtDawn.tracks.some((t) => t.kind === "instrumental")).toBe(true);
  });

  it("plays vocals alone when there are no instrumentals, and ignores instrumentals when asked for few tracks", () => {
    expect(arrangeSets(mixedVocals(9), [], { hour: 10, limit: 9 }).tracks.every((t) => t.kind === "vocal")).toBe(true);
    expect(arrangeSets(mixedVocals(9), instruments(3), { hour: 10, limit: 3 }).tracks).toHaveLength(3);
  });

  it("is the acceptance case: median uninterrupted block >= 3 minutes and instrumental share 15-30% every hour", () => {
    for (const hour of [6, 10, 13, 18, 20, 23]) {
      // An hour is about six refills of ten tracks; the queue is stateless between refills.
      const hourTracks: PoolTrack[] = [];
      for (let r = 0; r < 6; r++) {
        const vocals = Array.from({ length: 30 }, (_, i) => vocal(`r${r}v${i}`, LANGS[(i + r) % LANGS.length]!, ["calm"]));
        hourTracks.push(...arrangeSets(vocals, instruments(4, ["calm"]), { hour, limit: 10 }).tracks);
      }
      expect(median(runs(hourTracks))).toBeGreaterThanOrEqual(180);
      expect(share(hourTracks)).toBeGreaterThanOrEqual(0.15);
      expect(share(hourTracks)).toBeLessThanOrEqual(0.3);
    }
  });
});

describe("crossfade hints and flag", () => {
  it("fades in after a set mate and out before one", () => {
    expect(crossfadeFor({ id: "s", index: 0, size: 3 })).toEqual({ fadeInMs: 0, fadeOutMs: 2500 });
    expect(crossfadeFor({ id: "s", index: 1, size: 3 })).toEqual({ fadeInMs: 2500, fadeOutMs: 2500 });
    expect(crossfadeFor({ id: "s", index: 2, size: 3 })).toEqual({ fadeInMs: 2500, fadeOutMs: 0 });
    expect(crossfadeFor(undefined)).toBeNull();
  });

  it("is off unless STATION_SETS=1", () => {
    vi.stubEnv("STATION_SETS", "");
    expect(setsEnabled()).toBe(false);
    vi.stubEnv("STATION_SETS", "1");
    expect(setsEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("volume ramps", () => {
  it("probes whether volume can be set (iOS ignores it)", () => {
    expect(canSetVolume({ volume: 1 })).toBe(true);
    const ios = { get volume() { return 1; }, set volume(_v: number) { /* ignored */ } };
    expect(canSetVolume(ios)).toBe(false);
  });

  it("ramps linearly and stops at the target", () => {
    vi.useFakeTimers();
    let t = 0;
    const audio = { volume: 1 };
    rampVolume(audio, 0, 1000, () => t);
    t = 500; vi.advanceTimersByTime(50);
    expect(audio.volume).toBeCloseTo(0.5, 1);
    t = 1000; vi.advanceTimersByTime(50);
    expect(audio.volume).toBe(0);
    vi.useRealTimers();
  });

  it("jumps straight to the target for a zero-length ramp and can be cancelled", () => {
    const a = { volume: 0.2 };
    rampVolume(a, 1, 0);
    expect(a.volume).toBe(1);
    vi.useFakeTimers();
    let t = 0;
    const b = { volume: 1 };
    const cancel = rampVolume(b, 0, 1000, () => t);
    cancel();
    t = 1000; vi.advanceTimersByTime(200);
    expect(b.volume).toBe(1);
    vi.useRealTimers();
  });
});

describe("arrangeSets with listening history", () => {
  // A queue is about 10 tracks of 30 s; on its own it can never hold a 150 s instrumental under the cap.
  const short = (n: number) => Array.from({ length: n }, (_, i) => vocal(`s${i}`, "gu", [], 30));
  it("places no instrumental in one short queue without history", () => {
    expect(arrangeSets(short(10), instruments(3), { hour: 21, limit: 10 }).tracks.some((t) => t.kind === "instrumental")).toBe(false);
  });
  it("places one once the listener has played enough vocals, even with a single language locked", () => {
    const recent = Array.from({ length: 10 }, (_, i) => vocal(`h${i}`, "gu", [], 30));
    const { tracks } = arrangeSets(short(12), instruments(3), { hour: 21, limit: 10, recent });
    expect(tracks.some((t) => t.kind === "instrumental")).toBe(true);
  });
  it("does not add another while recent history already holds an instrumental share", () => {
    const recent = [...Array.from({ length: 6 }, (_, i) => vocal(`h${i}`, "gu", [], 30)), instr("hi0", [], 150)];
    expect(arrangeSets(short(12), instruments(3), { hour: 21, limit: 10, recent }).tracks.some((t) => t.kind === "instrumental")).toBe(false);
  });
});
