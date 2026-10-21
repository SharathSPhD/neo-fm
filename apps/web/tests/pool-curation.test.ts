import { describe, expect, it } from "vitest";

import { curateLake, curateTrack, cellSummary, NO_SIGNALS, type CurationTrack } from "../lib/pool/curation";

const t = (over: Partial<CurationTrack> = {}): CurationTrack => ({ id: "a", title: "A", language: "kn", genre: "folk", energy: "mid", diction_u: 95, judge_overall: 4, duration_seconds: 60, ...over });

describe("curateTrack", () => {
  it("keeps a clean track and does not flag one with no signals", () => {
    const c = curateTrack(t());
    expect(c.verdict).toBe("keep");
    expect(c.flags).toEqual([]);
  });
  it("flags low diction or low judge as watch, both as replace", () => {
    expect(curateTrack(t({ diction_u: 82 })).verdict).toBe("watch");
    expect(curateTrack(t({ diction_u: 82, judge_overall: 2.5 })).verdict).toBe("replace");
  });
  it("replaces on a high skip rate only once there are enough plays", () => {
    expect(curateTrack(t(), { ...NO_SIGNALS, plays: 4, skips: 4 }).flags).not.toContain("skipped");
    const c = curateTrack(t(), { ...NO_SIGNALS, plays: 8, skips: 6 });
    expect(c.flags).toContain("skipped");
    expect(c.verdict).toBe("replace");
  });
  it("replaces on an open report or a clip too short to be a song", () => {
    expect(curateTrack(t(), NO_SIGNALS, 1).verdict).toBe("replace");
    expect(curateTrack(t({ duration_seconds: 20 })).flags).toContain("too-short");
  });
  it("lets likes and shares lift the score, capped", () => {
    const base = curateTrack(t({ diction_u: 85, judge_overall: 3.5 })).score;
    expect(curateTrack(t({ diction_u: 85, judge_overall: 3.5 }), { ...NO_SIGNALS, likes: 9 }).score).toBe(Math.min(100, base + 10));
  });
  it("marks a track with no scores at all as unscored", () => {
    expect(curateTrack(t({ diction_u: null, judge_overall: null })).flags).toContain("unscored");
  });
});

describe("curateLake and cellSummary", () => {
  it("groups by language, lowest score first, and lists thin genre/energy cells first", () => {
    const tracks = [t({ id: "1" }), t({ id: "2", diction_u: 81 }), t({ id: "3", language: "hi", genre: "film-pop", energy: "high" }), t({ id: "4", genre: "folk", energy: "mid" })];
    const out = curateLake(tracks, new Map(), new Map());
    expect(Object.keys(out.languages).sort()).toEqual(["hi", "kn"]);
    expect(out.languages.kn!.tracks[0]!.id).toBe("2");
    expect(out.languages.kn!.total).toBe(3);
    expect(cellSummary([t({ id: "1" }), t({ id: "2" }), t({ id: "3", genre: "devotional" })])[0]).toEqual({ genre: "devotional", energy: "mid", tracks: 1 });
  });
});
