import { describe, expect, it } from "vitest";

import { pickArm, type PolicyRow } from "../lib/harness-policy/policy";
import { CUE_SETS, RENDER_ARMS, applyRenderArm, chooseRenderArm, dictionReward, pickRenderArm, renderFlagArm } from "../lib/harness-policy/render";
import { simulate } from "../lib/harness-policy/simulate";
import type { SupabaseClient } from "@supabase/supabase-js";

const row = (arm_id: string, role: PolicyRow["role"], over: Partial<PolicyRow> = {}): PolicyRow => ({ language: "ta", tier: "*", arm_id, role, max_share: 0.15, ...over });
const R = (xs: number[]) => xs.map(dictionReward);

/**
 * Sung-word match (Gemini transcribeSung, 0-100) from the render lab, docs/handoff/song-render-harness.md:
 * E5 (ta, te), E6 (kn), E7 (ta, te) for Claude romanization against the native-plus-ITRANS input; E8 for hi stock and for the mild
 * catalog cue (kn a 62/60 vs c 66/66). AI-scored, 2-5 renders per cell.
 */
const E = {
  kn: { mech: [63, 60, 62, 60], claude: [97, 99] },
  ta: { mech: [64, 75], claude: [95, 97, 100, 93, 98] },
  te: { mech: [64, 67], claude: [97, 100, 93, 98, 96] },
  knCue: { stock: [62, 60], cue: [66, 66] },
};

describe("render flag parity", () => {
  it("matches DICTION_CLAUDE_ROMAN and ENGLISH_STYLES when the policy is off", () => {
    expect(renderFlagArm({ DICTION_CLAUDE_ROMAN: "kn,ta,te" }, "ta").roman).toBe("claude");
    expect(renderFlagArm({ DICTION_CLAUDE_ROMAN: "kn,ta,te" }, "hi").roman).toBe("mech");
    expect(renderFlagArm({}, "kn").id).toBe("r_mech");
    expect(renderFlagArm({ ENGLISH_STYLES: "1" }, "en").id).toBe("r_en_styles");
    expect(renderFlagArm({}, "en").id).toBe("r_en_plain");
    const p = pickRenderArm({ env: { DICTION_CLAUDE_ROMAN: "ta" }, language: "ta", tier: "free", rows: [row("r_mech", "champion"), row("r_claude", "challenger")], global: [], user: [], seed: 1 });
    expect(p.source).toBe("flags");
    expect(p.arm.id).toBe("r_claude");
  });
  it("falls back to the flags with no render rows, and ignores lyric-arm rows", () => {
    const env = { HARNESS_POLICY: "1", DICTION_CLAUDE_ROMAN: "ta" };
    expect(pickRenderArm({ env, language: "ta", tier: "free", rows: [], global: [], user: [], seed: 1 }).source).toBe("flags");
    expect(pickRenderArm({ env, language: "ta", tier: "free", rows: [row("refs", "champion"), row("live", "challenger")], global: [], user: [], seed: 1 }).source).toBe("flags");
    // and render rows never leak into the lyric pick
    expect(pickArm({ env, language: "ta", tier: "free", rows: [row("r_mech", "champion"), row("r_claude", "challenger")], global: [], user: [], seed: 1 }).source).toBe("flags");
  });
  it("chooseRenderArm never touches the database when HARNESS_POLICY is off, and survives one that throws when it is on", async () => {
    const boom = { from: () => { throw new Error("db down"); } } as unknown as SupabaseClient;
    const off = await chooseRenderArm(boom, { env: { DICTION_CLAUDE_ROMAN: "kn" }, jobId: "j1", userId: "u1", language: "kn", tier: "free" });
    expect(off).toMatchObject({ source: "flags", arm: { id: "r_claude" } });
    const on = await chooseRenderArm(boom, { env: { HARNESS_POLICY: "1" }, jobId: "j1", userId: "u1", language: "kn", tier: "free" });
    expect(on).toMatchObject({ source: "flags", arm: { id: "r_mech" }, reason: "policy unavailable" });
  });
});

describe("render reward", () => {
  it("maps the stored diction match to 0..1 with the 80 gate at 0.6", () => {
    expect(dictionReward(100)).toBe(1);
    expect(dictionReward(80)).toBeCloseTo(0.6);
    expect(dictionReward(65)).toBeCloseTo(0.3);
    expect(dictionReward(20)).toBe(0);
  });
});

describe("render arms", () => {
  it("applies English style fragments only when the arm says so", () => {
    const frag = "Contemporary pop, 100-120 bpm.";
    expect(applyRenderArm(RENDER_ARMS.r_en_styles!, "en", "english song", frag)).toBe(`english song ${frag}`);
    expect(applyRenderArm(RENDER_ARMS.r_en_styles!, "en", `english song ${frag}`, frag)).toBe(`english song ${frag}`);
    expect(applyRenderArm(RENDER_ARMS.r_en_plain!, "en", `english song ${frag}`, frag)).toBe("english song");
    expect(applyRenderArm(RENDER_ARMS.r_en_styles!, "kn", "kannada song", frag)).toBe("kannada song");
  });
  it("ships no cue wording that has not earned a place", () => {
    expect(Object.keys(CUE_SETS)).toEqual([]);
    expect(applyRenderArm({ ...RENDER_ARMS.r_mech!, cue: "strong" }, "kn", "x", undefined)).toBe("x");
  });
});

describe("render replay on E-series data", () => {
  const pair = (lang: "kn" | "ta" | "te") => ({ r_mech: R(E[lang].mech), r_claude: R(E[lang].claude) });
  it("caps Claude romanization as a challenger, and the cap holds even though it looks far better", () => {
    for (const lang of ["kn", "ta", "te"] as const) {
      const r = simulate({ rows: [row("r_mech", "champion", { language: lang }), row("r_claude", "challenger", { language: lang })], rewards: pair(lang), jobs: 3000, language: lang, seed: 21, registry: RENDER_ARMS, fallbackArm: RENDER_ARMS.r_mech });
      expect(r.share.r_claude ?? 0).toBeLessThanOrEqual(0.18);
      expect(r.sources.policy).toBe(3000);
    }
  });
  it("once Claude romanization is a champion the bandit sends most songs to it within a few hundred jobs", () => {
    for (const lang of ["kn", "ta", "te"] as const) {
      const r = simulate({ rows: [row("r_mech", "champion", { language: lang }), row("r_claude", "champion", { language: lang })], rewards: pair(lang), jobs: 2000, language: lang, seed: 22, registry: RENDER_ARMS, fallbackArm: RENDER_ARMS.r_mech });
      expect(r.lateShare.r_claude).toBeGreaterThan(0.9);
      expect(r.convergedAt).not.toBeNull();
      expect(r.convergedAt!).toBeLessThan(400);
    }
  });
  it("does not separate the mild catalog cue from the stock line (E8): shares stay mixed", () => {
    const rows = [row("r_mech", "champion", { language: "kn" }), row("r_claude", "champion", { language: "kn" })];
    // stand-in arms: stock = r_mech, cue = r_claude, rewards from the E8 kn pairs
    const r = simulate({ rows, rewards: { r_mech: R(E.knCue.stock), r_claude: R(E.knCue.cue) }, jobs: 3000, language: "kn", seed: 23, registry: RENDER_ARMS, fallbackArm: RENDER_ARMS.r_mech });
    // 62/60 vs 66/66 is a ~0.13 reward gap on four renders: the bandit leans, but keeps exploring
    expect(r.lateShare.r_mech ?? 0).toBeGreaterThan(0.03);
  });
  it("falls back to the flag arm for every job with the policy off", () => {
    const r = simulate({ rows: [], rewards: {}, jobs: 200, language: "kn", env: { DICTION_CLAUDE_ROMAN: "kn" }, registry: RENDER_ARMS, fallbackArm: renderFlagArm({ DICTION_CLAUDE_ROMAN: "kn" }, "kn") });
    expect(r.sources).toEqual({ flags: 200 });
    expect(r.share.r_claude).toBe(1);
  });
});
