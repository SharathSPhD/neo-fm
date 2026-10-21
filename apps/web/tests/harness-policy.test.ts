import { describe, expect, it } from "vitest";

import { mean, mulberry32, sampleBeta, shrink } from "../lib/harness-policy/bandit";
import { flagArm, pickArm, seedFor, type PolicyRow } from "../lib/harness-policy/policy";
import { songReward } from "../lib/harness-policy/reward";
import { chooseHarnessArm } from "../lib/harness-policy/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";

const row = (arm_id: string, role: PolicyRow["role"] = "champion", over: Partial<PolicyRow> = {}): PolicyRow => ({ language: "kn", tier: "*", arm_id, role, max_share: 0.15, ...over });
const base = { env: { HARNESS_POLICY: "1" }, language: "kn", tier: "free", global: [], user: [], seed: 1 };

describe("bandit", () => {
  it("samples Beta with the right mean", () => {
    const rng = mulberry32(7);
    const xs = Array.from({ length: 4000 }, () => sampleBeta({ a: 8, b: 2 }, rng));
    expect(xs.reduce((a, x) => a + x, 0) / xs.length).toBeCloseTo(0.8, 1);
  });
  it("shrinks a thin personal posterior toward the language one", () => {
    const s = shrink({ a: 3, b: 1 }, { a: 1, b: 9 });
    expect(mean(s)).toBeLessThan(0.75);
    expect(mean(s)).toBeGreaterThan(mean({ a: 1, b: 9 }));
  });
});

describe("pickArm", () => {
  it("is exactly the env flags when HARNESS_POLICY is off", () => {
    const p = pickArm({ ...base, env: { PCE_HARNESS_REFS: "kn" }, rows: [row("live"), row("refs_opus")] });
    expect(p.source).toBe("flags");
    expect(p.arm.id).toBe("refs");
    expect(flagArm({}, "kn", undefined).id).toBe("live");
    expect(flagArm({}, "kn", "claude-opus-5-5").id).toBe("refs_opus");
  });
  it("falls back to the flags when the table has no rows for the language", () => {
    const p = pickArm({ ...base, rows: [row("refs", "champion", { language: "hi" })] });
    expect(p.source).toBe("flags");
  });
  it("never gives a Free listener an Opus arm", () => {
    const p = pickArm({ ...base, tier: "free", rows: [row("refs_opus")] });
    expect(p.source).toBe("flags");
    const paid = pickArm({ ...base, tier: "pro", rows: [row("refs_opus")] });
    expect(paid.arm.id).toBe("refs_opus");
  });
  it("sends the challenger at most about max_share of the time", () => {
    const rows = [row("live"), row("refs", "challenger", { max_share: 0.2 })];
    // champion has the strong posterior so the challenger only wins when it is allowed in and beats it
    const global = [{ arm_id: "live", a: 5, b: 20 }, { arm_id: "refs", a: 40, b: 5 }];
    let challenger = 0;
    for (let s = 0; s < 1000; s++) if (pickArm({ ...base, rows, global, seed: s }).arm.id === "refs") challenger++;
    expect(challenger).toBeGreaterThan(120);
    expect(challenger).toBeLessThan(280);
  });
  it("moves toward the arm a listener keeps finishing", () => {
    const rows = [row("live"), row("refs", "champion")];
    const user = [{ arm_id: "refs", a: 40, b: 2 }, { arm_id: "live", a: 2, b: 40 }];
    let refs = 0;
    for (let s = 0; s < 200; s++) if (pickArm({ ...base, rows, user, seed: s }).arm.id === "refs") refs++;
    expect(refs).toBeGreaterThan(180);
  });
  it("keeps the same arm for a retried job", () => {
    const rows = [row("live"), row("refs")];
    const a = pickArm({ ...base, rows, seed: seedFor("job-1") }).arm.id;
    expect(pickArm({ ...base, rows, seed: seedFor("job-1") }).arm.id).toBe(a);
  });
});

describe("songReward", () => {
  it("is null with no signal, high for likes and low for regenerates", () => {
    expect(songReward([])).toBeNull();
    expect(songReward([{ kind: "play_pct", value: 0.1 }])).toBeNull();
    expect(songReward([{ kind: "like" }, { kind: "share" }])!).toBeGreaterThan(0.9);
    expect(songReward([{ kind: "regenerate" }, { kind: "dislike" }])!).toBeLessThan(0.2);
  });
});

describe("chooseHarnessArm", () => {
  const throwingDb = { from: () => { throw new Error("db down"); } } as unknown as SupabaseClient;
  it("touches no database when the policy is off", async () => {
    const p = await chooseHarnessArm(throwingDb, { env: { PCE_HARNESS_REFS: "te" }, jobId: "j", userId: "u", language: "te", tier: "free", premiumModel: undefined });
    expect(p.arm.id).toBe("refs");
  });
  it("falls back to the flags when the policy tables are unreachable", async () => {
    const p = await chooseHarnessArm(throwingDb, { env: { HARNESS_POLICY: "1" }, jobId: "j", userId: "u", language: "kn", tier: "free", premiumModel: undefined });
    expect(p.source).toBe("flags");
    expect(p.arm.id).toBe("live");
  });
});
