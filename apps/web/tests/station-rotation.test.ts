import { describe, expect, it } from "vitest";

import { programQueue } from "../lib/station/program";
import type { PoolTrack } from "../lib/station/rank";
import { allowed, RELAXATION, violations, type RotationState } from "../lib/station/rotation";

const t = (id: string, language = "hi", family = `${language}:${id}`): PoolTrack => ({ id, language, tags: [], family });
const H = 3_600_000;
const state = (over: Partial<RotationState> = {}): RotationState => ({ history: [], recentIds: new Set(), languageLocked: false, ...over });
const ctx = (rotation: RotationState, limit = 8) => ({ hour: 13, month: 3, day: 1, familiar: new Set<string>(), limit, rotation });
const STRICT = RELAXATION[0]!;

describe("allowed", () => {
  it("blocks a track played in the last 4 hours", () => {
    expect(allowed(t("a"), state({ recentIds: new Set(["a"]) }), [], STRICT)).toBe(false);
    expect(allowed(t("b"), state({ recentIds: new Set(["a"]) }), [], STRICT)).toBe(true);
  });
  it("blocks a family seen in the last 5 tracks but not the 6th back", () => {
    const hist = ["f", "x1", "x2", "x3", "x4"].map((id) => t(id, "hi", id === "f" ? "fam" : id));
    expect(allowed(t("n", "hi", "fam"), state({ history: hist, languageLocked: true }), [], STRICT)).toBe(false);
    expect(allowed(t("n", "hi", "fam"), state({ history: [...hist, t("x5")], languageLocked: true }), [], STRICT)).toBe(true);
  });
  it("blocks a fourth same-language track in a row unless the language is locked", () => {
    const hist = [t("a"), t("b"), t("c")];
    expect(allowed(t("d"), state({ history: hist }), [], STRICT)).toBe(false);
    expect(allowed(t("d", "ta"), state({ history: hist }), [], STRICT)).toBe(true);
    expect(allowed(t("d"), state({ history: hist, languageLocked: true }), [], STRICT)).toBe(true);
  });
});

describe("programQueue with rotation", () => {
  const pool = [...["h1", "h2", "h3", "h4", "h5", "h6"].map((id) => t(id, "hi")), ...["t1", "t2", "t3"].map((id) => t(id, "ta"))];

  it("never runs more than 3 of one language when others exist", () => {
    const q = programQueue(pool, ctx(state(), 9));
    const v = violations(q, q.map((_, i) => i * 60_000));
    expect(v.languageRuns).toBe(0);
  });
  it("skips tracks played in the last 4 hours", () => {
    const q = programQueue(pool, ctx(state({ recentIds: new Set(["h1", "h2"]) }), 7));
    expect(q.map((x) => x.id)).not.toContain("h1");
    expect(q.map((x) => x.id)).not.toContain("h2");
  });
  it("carries the language run from earlier plays into the next queue", () => {
    const q = programQueue(pool, ctx(state({ history: [t("p1"), t("p2"), t("p3")] }), 3));
    expect(q[0]!.language).toBe("ta");
  });
  it("relaxes the rules rather than returning nothing when the pool is tiny", () => {
    const q = programQueue([t("only")], ctx(state({ recentIds: new Set(["only"]) }), 3));
    expect(q).toHaveLength(1);
  });
  it("keeps families apart", () => {
    const fam = [t("a1", "hi", "A"), t("a2", "hi", "A"), t("b1", "ta", "B"), t("c1", "te", "C"), t("d1", "kn", "D"), t("e1", "bn", "E"), t("f1", "hi", "F")];
    const q = programQueue(fam, ctx(state(), 7));
    expect(violations(q, q.map((_, i) => i)).familyRepeats).toBe(0);
  });
});

describe("violations", () => {
  it("counts each kind", () => {
    const seq = [t("a"), t("b"), t("c"), t("d"), t("a")];
    const v = violations(seq, [0, 1, 2, 3, 4].map((i) => i * H * 0.1));
    expect(v.trackRepeats).toBe(1);
    expect(v.languageRuns).toBe(2); // 4th and 5th hi in a row
  });
  it("does not count a repeat after 4 hours or a run under a locked language", () => {
    expect(violations([t("a"), t("a")], [0, 5 * H]).trackRepeats).toBe(0);
    expect(violations([t("a"), t("b"), t("c"), t("d")], [0, 1, 2, 3], true).languageRuns).toBe(0);
  });
});
