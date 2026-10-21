import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { pickArm, type PolicyRow } from "../lib/harness-policy/policy";
import { rewardsFromBattles, simulate } from "../lib/harness-policy/simulate";
import { fadedPrior, tasteArmPrior, TASTE_PRIOR_CAP } from "../lib/harness-policy/taste";

const BATTLES = resolve(__dirname, "../../../tools/arena/data/battles.jsonl");
const lines = (() => { try { return readFileSync(BATTLES, "utf8").split("\n"); } catch { return []; } })();
const row = (arm_id: string, role: PolicyRow["role"], over: Partial<PolicyRow> = {}): PolicyRow => ({ language: "kn", tier: "*", arm_id, role, max_share: 0.15, ...over });
const rows = [row("live", "champion"), row("refs", "challenger")];
const flip = (p: number, n = 200) => Array.from({ length: n }, (_, k) => ((k * 0.618034) % 1 < p ? 1 : 0));

describe("policy replay", () => {
  it("holds a challenger at or under max_share however good it looks", () => {
    const r = simulate({ rows, rewards: { live: flip(0.5), refs: flip(0.95) }, jobs: 4000, seed: 3 });
    expect(r.share.refs).toBeLessThanOrEqual(0.15 + 0.03);
    expect(r.sources.policy).toBe(4000);
  });
  it("lets a champion pair converge on the better arm", () => {
    const two = [row("live", "champion"), row("refs", "champion")];
    const r = simulate({ rows: two, rewards: { live: flip(0.4), refs: flip(0.7) }, jobs: 3000, seed: 5 });
    expect(r.lateShare.refs).toBeGreaterThan(0.75);
    expect(r.convergedAt).not.toBeNull();
    expect(r.convergedAt!).toBeLessThan(600);
  });
  it("does not run away to a worse arm when arms are equal (no reward hacking from noise)", () => {
    const two = [row("live", "champion"), row("refs", "champion")];
    const r = simulate({ rows: two, rewards: { live: flip(0.5), refs: flip(0.5) }, jobs: 3000, seed: 9 });
    expect(Math.abs(r.share.refs! - 0.5)).toBeLessThan(0.3);
  });
  it("falls back to the flags for every job when the policy is off or the table is empty", () => {
    const off = simulate({ rows, rewards: {}, jobs: 300, env: { PCE_HARNESS_REFS: "kn" } });
    expect(off.sources).toEqual({ flags: 300 });
    expect(off.share.refs).toBe(1);
    const empty = simulate({ rows: [], rewards: {}, jobs: 300, env: { HARNESS_POLICY: "1" } });
    expect(empty.sources).toEqual({ flags: 300 });
    expect(empty.share.live).toBe(1);
  });
  it("replays the recorded harness-refs vs prod battles per language without breaking the cap", () => {
    const rw = rewardsFromBattles(lines, "harness-refs", "prod-haiku6-pce-sonnet-polish");
    const langs = Object.keys(rw);
    expect(langs.length).toBeGreaterThan(0);
    for (const lang of langs) {
      const r = simulate({ rows: [row("live", "champion", { language: lang }), row("refs", "challenger", { language: lang })], rewards: { live: [0.5], refs: rw[lang]! }, jobs: 2000, language: lang, seed: 11 });
      expect(r.share.refs ?? 0).toBeLessThanOrEqual(0.18);
    }
  });
});

describe("taste prior", () => {
  it("is empty without a profile and bounded with one", () => {
    expect(tasteArmPrior(null)).toEqual({});
    const p = tasteArmPrior({ v: 1, genres: ["ghazal", "carnatic", "folk", "sufi"], register: "formal" });
    expect(p.refs).toBe(TASTE_PRIOR_CAP);
    expect(p.refs_opus).toBe(TASTE_PRIOR_CAP);
    expect(tasteArmPrior({ v: 1, genres: ["pop", "rock"] })).toEqual({ live: 0.02 });
  });
  it("fades with the listener's own data", () => {
    expect(fadedPrior({ refs: 0.05 }, "refs", 0)).toBeCloseTo(0.05);
    expect(fadedPrior({ refs: 0.05 }, "refs", 10)).toBeCloseTo(0.025);
    expect(fadedPrior({ refs: 0.05 }, "refs", 90)).toBeLessThan(0.006);
    expect(fadedPrior({ refs: 9 }, "refs", 0)).toBe(TASTE_PRIOR_CAP);
  });
  it("tilts a cold-start pick toward corpus refs and is overruled by the listener's own results", () => {
    const two = [row("live", "champion"), row("refs", "champion")];
    const tilt = { refs: 0.05 };
    const cold = (user: { arm_id: string; a: number; b: number }[]) => {
      let refs = 0;
      for (let s = 1; s <= 1500; s++) if (pickArm({ env: { HARNESS_POLICY: "1" }, language: "kn", tier: "creator", rows: two, global: [], user, tastePrior: tilt, seed: s }).arm.id === "refs") refs++;
      return refs / 1500;
    };
    const none = (() => { let c = 0; for (let s = 1; s <= 1500; s++) if (pickArm({ env: { HARNESS_POLICY: "1" }, language: "kn", tier: "creator", rows: two, global: [], user: [], seed: s }).arm.id === "refs") c++; return c / 1500; })();
    expect(cold([])).toBeGreaterThan(none);
    // 30 settled songs where refs did badly and live did well: the prior no longer matters
    const lived = cold([{ arm_id: "refs", a: 4, b: 28 }, { arm_id: "live", a: 25, b: 7 }]);
    expect(lived).toBeLessThan(0.1);
  });
});
