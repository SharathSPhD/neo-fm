import { describe, expect, it } from "vitest";

import { rankTracks, type PoolTrack, type StationSignal } from "../lib/station/rank";

const pool: PoolTrack[] = [
  { id: "a", language: "hi", tags: ["birthday", "upbeat"] },
  { id: "b", language: "hi", tags: ["devotional", "calm"] },
  { id: "c", language: "ta", tags: ["birthday"] },
  { id: "d", language: "hi", tags: ["wedding"] },
];
const zero = () => 0;
const ids = (r: PoolTrack[]) => r.map((t) => t.id);

describe("rankTracks", () => {
  it("filters to the requested language when the pool has it", () => {
    expect(ids(rankTracks(pool, [], { language: "ta", random: zero }))).toEqual(["c"]);
  });
  it("ignores an unavailable language instead of returning nothing", () => {
    expect(rankTracks(pool, [], { language: "bn", random: zero })).toHaveLength(4);
  });
  it("boosts wanted tags", () => {
    expect(ids(rankTracks(pool, [], { wantTags: ["wedding"], random: zero }))[0]).toBe("d");
  });
  it("learns from likes: a liked track's tags lift similar tracks", () => {
    const s: StationSignal[] = [{ trackId: "b", kind: "like", ageMs: 1000 * 3600 * 24 }];
    const r = ids(rankTracks(pool, s, { random: zero }));
    expect(r[0]).toBe("b");
  });
  it("pushes skipped tracks down", () => {
    const s: StationSignal[] = [{ trackId: "a", kind: "skip", ageMs: 7 * 3_600_000 }];
    expect(ids(rankTracks(pool, s, { random: zero })).indexOf("a")).toBeGreaterThan(0);
  });
  it("pushes just-played tracks down", () => {
    const s: StationSignal[] = [{ trackId: "d", kind: "play", ageMs: 1000 }];
    const r = ids(rankTracks(pool, s, { wantTags: ["wedding"], random: zero }));
    expect(r[r.length - 1]).toBe("d");
  });
  it("respects limit", () => {
    expect(rankTracks(pool, [], { limit: 2 })).toHaveLength(2);
  });
});
