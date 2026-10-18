import { describe, expect, it } from "vitest";

import { parseSteer, steerQueue } from "../lib/station/steer";

const t = (id: string, language: string, tags: string[]) => ({ id, language, tags });
const queue = [
  t("a", "hi", ["energetic", "pop"]),
  t("b", "hi", ["calm", "slow"]),
  t("c", "ta", ["devotional", "classical"]),
  t("d", "ta", ["calm", "classical"]),
];

describe("steerQueue", () => {
  it("is a no-op without a steer", () => {
    expect(steerQueue(queue, queue, {}).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("drops the track now playing", () => {
    expect(steerQueue(queue, queue, {}, "a").map((x) => x.id)).toEqual(["b", "c", "d"]);
  });
  it("calmer brings calm tracks first and pushes energetic ones last", () => {
    expect(steerQueue(queue, queue, { energy: "down" }).map((x) => x.id)).toEqual(["b", "d", "c", "a"]);
  });
  it("livelier brings energetic tracks first", () => {
    expect(steerQueue(queue, queue, { energy: "up" })[0]!.id).toBe("a");
  });
  it("more like this puts the closest tags and language first", () => {
    // seed c (ta, devotional+classical): d shares classical and language, so it leads
    expect(steerQueue(queue, queue, { moreLike: "c" }, "c").map((x) => x.id)).toEqual(["d", "a", "b"]);
  });
  it("ignores a seed that is not in the pool", () => {
    expect(steerQueue(queue, queue, { moreLike: "zzz" }).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("parseSteer", () => {
  const id = "41f1e639-1111-4222-8333-444455556666";
  it("accepts valid params", () => {
    expect(parseSteer(new URLSearchParams({ energy: "down", like: id, exclude: id }))).toEqual({ energy: "down", moreLike: id, exclude: id });
  });
  it("drops malformed params", () => {
    expect(parseSteer(new URLSearchParams({ energy: "max", like: "x", exclude: "y" }))).toEqual({ energy: null, moreLike: null, exclude: null });
  });
});
