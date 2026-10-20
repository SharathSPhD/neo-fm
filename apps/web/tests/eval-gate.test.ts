import { describe, expect, it } from "vitest";
import { estimateGate, meter } from "../lib/eval/cost";
import { allEvalBriefs } from "../lib/eval/briefs-gen";
import { OCCASION_BRIEFS } from "../lib/eval/occasion-briefs";
import { runPolishGate, type GateCase, type GateDeps, type PairJudgment } from "../lib/eval/polish-gate";

const win: PairJudgment = { winner: "pce", detail: { dim_diff: { prosody: 1 } } };
const lose: PairJudgment = { winner: "single", detail: { dim_diff: { prosody: -1 } } };
const mk = (i: number, live: PairJudgment = lose): GateCase => ({ set: i % 2 ? "occasion" : "held", id: `x-${i}`, language: "Hindi", style: "s", brief: "b", draft: "d", baseline: "base", stored: { claude: live, gemini: live.winner } });
const deps = (cand: PairJudgment, over: Partial<GateDeps> = {}): GateDeps => ({
  polish: async () => "polished", judge: async () => cand, judgeGemini: async () => ({ winner: cand.winner }), spentUsd: () => 0, ...over,
});

describe("occasion briefs", () => {
  it("has unique frozen ids, 3 per language, none colliding with the 150-brief research set", () => {
    expect(OCCASION_BRIEFS.length).toBe(15);
    expect(new Set(OCCASION_BRIEFS.map((b) => b.id)).size).toBe(15);
    for (const l of ["Kannada", "Tamil", "Telugu", "Hindi", "Bengali"]) expect(OCCASION_BRIEFS.filter((b) => b.language === l).length).toBe(3);
    const research = new Set(allEvalBriefs().map((b) => b.id));
    for (const b of OCCASION_BRIEFS) expect(research.has(b.id)).toBe(false);
  });
});

describe("cost estimate and meter", () => {
  it("scales with briefs and counts live recompute and seeding", () => {
    const base = estimateGate({ briefs: 12, liveRecompute: 0 });
    expect(base.claude_usd).toBeGreaterThan(0);
    expect(estimateGate({ briefs: 12, liveRecompute: 12 }).claude_usd).toBeCloseTo(base.claude_usd * 2, 2);
    expect(estimateGate({ briefs: 12, liveRecompute: 0, seedBriefs: 15 }).claude_usd).toBeGreaterThan(base.claude_usd);
    expect(base.gemini_calls).toBe(24);
  });
  it("a 12 held-out + 15 occasion gate fits well inside the USD 16 eval budget", () => {
    expect(estimateGate({ briefs: 27, liveRecompute: 15 }).claude_usd).toBeLessThan(3);
  });
  it("meters tokens by model and tolerates a missing usage block", () => {
    meter.reset();
    meter.record("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 0 });
    meter.record("claude-sonnet-5-5", undefined);
    expect(meter.usd()).toBe(3);
    expect(meter.snapshot().by_model["claude-sonnet-5-5"]!.calls).toBe(2);
    meter.reset();
  });
});

describe("polish gate decision rule", () => {
  const cases = Array.from({ length: 10 }, (_, i) => mk(i));
  it("recommends when both families see a clear gain with no dimension worse", async () => {
    const r = await runPolishGate(cases, "tpl", deps(win), { maxUsd: 5 });
    expect(r.verdict).toBe("recommend");
    expect(r.by_set.held!.n + r.by_set.occasion!.n).toBe(10);
  });
  it("rejects without a Gemini judge: one family is not enough", async () => {
    const r = await runPolishGate(cases, "tpl", deps(win, { judgeGemini: undefined }), { maxUsd: 5 });
    expect(r.gemini_ok).toBe(false);
    expect(r.verdict).toBe("reject");
  });
  it("rejects when a dimension regresses by more than 0.15 even with more wins", async () => {
    const reg: PairJudgment = { winner: "pce", detail: { dim_diff: { prosody: -1 } } };
    const stronger = cases.map((c) => ({ ...c, stored: { claude: { winner: "single" as const, detail: { dim_diff: { prosody: 1 } } }, gemini: "single" as const } }));
    const r = await runPolishGate(stronger, "tpl", deps(reg), { maxUsd: 5 });
    expect(r.worse_dims).toContain("prosody");
    expect(r.verdict).toBe("reject");
  });
  it("stops at the spend cap and refuses to recommend an incomplete run", async () => {
    let spent = 0;
    const r = await runPolishGate(cases, "tpl", deps(win, { spentUsd: () => spent, judge: async () => { spent += 1; return win; } }), { maxUsd: 3, concurrency: 2 });
    expect(r.skipped_for_budget).toBeGreaterThan(0);
    expect(r.incomplete).toBe(true);
    expect(r.verdict).toBe("reject");
  });
  it("recomputes the live template only for cases without a stored verdict", async () => {
    let polishes = 0;
    const open = cases.map((c, i) => (i < 3 ? { ...c, stored: undefined } : c));
    await runPolishGate(open, "tpl", deps(win, { polish: async () => { polishes++; return "p"; } }), { maxUsd: 5 });
    expect(polishes).toBe(10 + 3);
  });
});
