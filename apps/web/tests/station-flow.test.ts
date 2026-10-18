import { describe, expect, it } from "vitest";

import { CLASH, clashes, energyOf, feelOf, transitionCost } from "../lib/station/flow";
import { programQueue } from "../lib/station/program";
import type { PoolTrack } from "../lib/station/rank";
import { arrangeSets } from "../lib/station/sets";
import { HOURS, LANGS, POOL, flowStats, playSession, sumStats } from "./helpers/station-sim";

type Opts = Partial<Pick<PoolTrack, "energy" | "kind">> & { genre?: string };
const track = (id: string, language: string, tags: string[], o: Opts = {}): PoolTrack => ({
  id, language, tags: o.genre ? [...tags, o.genre] : tags, energy: o.energy ?? null, kind: o.kind ?? "vocal", durationSeconds: o.kind === "instrumental" ? 150 : 60,
});
const bhajan = (id: string, language = "hi") => track(id, language, ["devotional", "bhakti", "calm"], { genre: "bhajan", energy: "low" });
const dhol = (id: string, language = "hi") => track(id, language, ["energetic", "festive"], { genre: "bhangra", energy: "high" });
const mellow = (id: string, language = "hi") => track(id, language, ["nostalgic"], { genre: "ballad", energy: "mid" });

const feelClash = (a: PoolTrack, b: PoolTrack) => (feelOf(a) === "devotional" && feelOf(b) === "dance") || (feelOf(a) === "dance" && feelOf(b) === "devotional");

describe("feel and energy", () => {
  it("reads devotional, dance and neutral feels from tags", () => {
    expect(feelOf(bhajan("a"))).toBe("devotional");
    expect(feelOf(dhol("b"))).toBe("dance");
    expect(feelOf(mellow("c"))).toBe("other");
  });

  it("calls garba a dance even though it carries a bhakti theme, and a high-energy bhakti track too", () => {
    expect(feelOf(track("g", "gu", ["bhakti", "festive"], { genre: "garba", energy: "high" }))).toBe("dance");
    expect(feelOf(track("w", "ta", ["devotional", "celebratory"], { energy: "high" }))).toBe("dance");
  });

  it("uses tagger energy when present and tags otherwise", () => {
    expect(energyOf(track("a", "hi", ["energetic", "fast"]))).toBe(2);
    expect(energyOf(track("b", "hi", ["calm", "slow"]))).toBe(0);
    expect(energyOf(track("c", "hi", ["calm", "slow"], { energy: "high" }))).toBe(2);
    expect(energyOf(track("d", "hi", []))).toBe(1);
  });

  it("treats devotional next to dance and low next to high energy as clashes, and one energy step as smooth", () => {
    expect(clashes(bhajan("a"), dhol("b"))).toBe(true);
    expect(clashes(dhol("b"), bhajan("a"))).toBe(true);
    expect(clashes(bhajan("a"), mellow("c"))).toBe(false);
    expect(clashes(mellow("c"), dhol("b"))).toBe(false);
    expect(clashes(track("l", "hi", ["calm"], { energy: "low" }), track("h", "hi", ["joyful"], { energy: "high" }))).toBe(true);
    expect(transitionCost(undefined, dhol("b"))).toBe(0);
  });

  it("keeps a sad track away from a party track", () => {
    const sad = track("s", "hi", ["melancholic"], { energy: "mid" });
    expect(transitionCost(sad, dhol("b"))).toBeGreaterThan(transitionCost(sad, mellow("c")));
  });

  it("leaves untagged tracks alone", () => {
    expect(transitionCost(track("u", "hi", []), track("v", "hi", []))).toBe(0);
  });
});

describe("arrangeSets keeps moods apart", () => {
  it("never puts a dance track next to a devotional one while another choice exists", () => {
    const pool = [bhajan("b1"), dhol("d1"), bhajan("b2"), dhol("d2"), bhajan("b3"), dhol("d3"), mellow("m1"), mellow("m2"), mellow("m3")];
    const { tracks } = arrangeSets(pool, [], { hour: 10, limit: 9 });
    for (let i = 1; i < tracks.length; i++) expect(feelClash(tracks[i - 1]!, tracks[i]!)).toBe(false);
  });

  it("fills a devotional block with devotional mates and a dance block with dance mates", () => {
    const pool = [bhajan("b1"), dhol("d1"), mellow("m1"), bhajan("b2"), dhol("d2"), bhajan("b3"), dhol("d3"), mellow("m2")];
    const { tracks, sets } = arrangeSets(pool, [], { hour: 10, limit: 6 });
    const first = tracks.slice(0, 3);
    expect(first.map((t) => t.id).sort()).toEqual(["b1", "b2", "b3"]);
    expect(new Set(first.map((t) => sets.get(t.id)?.id)).size).toBe(1);
  });

  it("starts a refill from what the listener heard last, not from the top of the list", () => {
    const pool = [dhol("d1"), dhol("d2"), mellow("m1"), mellow("m2")];
    const { tracks } = arrangeSets(pool, [], { hour: 10, limit: 2, recent: [bhajan("heard")] });
    expect(tracks[0]!.id).not.toBe("d1");
    expect(tracks.every((t) => !feelClash(bhajan("heard"), t))).toBe(true);
  });

  it("does not drop a high-energy instrumental after a devotional block", () => {
    const pool = Array.from({ length: 9 }, (_, i) => bhajan(`b${i}`));
    const inst = [track("i1", "zxx", ["energetic"], { genre: "pop", energy: "high", kind: "instrumental" })];
    const { tracks } = arrangeSets(pool, inst, { hour: 13, limit: 9 });
    expect(tracks.some((t) => t.kind === "instrumental")).toBe(false);
  });

  it("still serves a queue when every neighbour clashes, rather than stalling", () => {
    const pool = [bhajan("b1"), dhol("d1")];
    expect(arrangeSets(pool, [], { hour: 10, limit: 2 }).tracks).toHaveLength(2);
  });
});

describe("programQueue steps around clashes", () => {
  it("prefers a non-clashing next track even when a clashing one ranks higher", () => {
    const ranked = [dhol("d1"), mellow("m1"), dhol("d2")];
    const out = programQueue(ranked, { hour: 10, month: 6, day: 1, familiar: new Set(), limit: 2, rotation: { history: [bhajan("heard")], recentIds: new Set(), languageLocked: true } });
    expect(out[0]!.id).toBe("m1");
  });
});

describe("the real pool snapshot (327 admitted tracks, 2026-10-18)", () => {
  const sessions = (sets: boolean, seeds: number[]) => {
    const all = [];
    for (const lang of LANGS) for (const hour of HOURS) for (const seed of seeds) all.push(flowStats(playSession({ hour, lang, seed, sets })));
    return sumStats(all);
  };

  it("has no devotional-next-to-dance and almost no low-to-high energy jumps in station sets, across languages and dayparts", () => {
    const s = sessions(true, [1, 2]);
    expect(s.pairs).toBeGreaterThan(10_000);
    expect(s.feelClashes).toBe(0);
    expect(s.energyJumps / s.pairs).toBeLessThan(0.005);
  });

  it("keeps the smooth-flow gain in the plain clock wheel too (before the change: 5% feel clashes, 15% energy jumps)", () => {
    const s = sessions(false, [1]);
    expect(s.feelClashes / s.pairs).toBeLessThan(0.015);
    expect(s.energyJumps / s.pairs).toBeLessThan(0.05);
  });

  it("holds the mean transition cost low", () => {
    expect(sessions(true, [3]).meanCost).toBeLessThan(0.6);
    expect(CLASH).toBeGreaterThan(1);
  });
});

describe("tag accuracy on the pool snapshot", () => {
  it("rates every lullaby low energy and no dance-floor genre low energy", () => {
    const lullabies = POOL.filter((t) => t.tags.includes("lullaby"));
    expect(lullabies.length).toBeGreaterThan(5);
    expect(lullabies.every((t) => t.energy === "low")).toBe(true);
    const dance = POOL.filter((t) => ["bhangra", "garba", "dandiya", "folk-boliyan", "wedding-jaggo"].some((g) => t.tags.includes(g)));
    expect(dance.length).toBeGreaterThan(5);
    expect(dance.every((t) => t.energy !== "low")).toBe(true);
  });

  it("never tags a track both calm and energetic", () => {
    expect(POOL.filter((t) => t.tags.includes("calm") && t.tags.includes("energetic"))).toEqual([]);
  });

  it("keeps devotional tracks to a quiet feel, bar the dance-floor ones the sequencer already treats as dance", () => {
    const devotional = POOL.filter((t) => t.kind !== "instrumental" && feelOf(t) === "devotional");
    expect(devotional.length).toBeGreaterThan(30);
    expect(devotional.filter((t) => t.energy === "high")).toEqual([]);
  });
});
