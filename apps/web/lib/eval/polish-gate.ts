/**
 * The polish-prompt promotion gate: candidate template vs the live template on held-out and occasion briefs,
 * judged blind against the same best-of-6 baseline by two model families (Claude + Gemini).
 * Pure over injected deps so the decision rule is unit-tested without spending anything.
 */
export type Winner = "pce" | "single" | "tie";
export interface PairJudgment { winner: Winner; detail: { dim_diff?: Record<string, number> } }
export type EvalSet = "held" | "occasion";

export interface GateCase {
  set: EvalSet; id: string; language: string; style: string; brief: string;
  draft: string; baseline: string;
  /** Stored verdicts for the live template on this brief (fullB); recomputed when absent. */
  stored?: { claude?: PairJudgment; gemini?: Winner };
}

export interface GateDeps {
  /** template === null means the live template */
  polish: (template: string | null, c: GateCase) => Promise<string>;
  judge: (c: GateCase, polished: string) => Promise<PairJudgment>;
  /** absent when GEMINI_API_KEY is missing: the gate then can never recommend */
  judgeGemini?: (c: GateCase, polished: string) => Promise<{ winner: Winner }>;
  spentUsd: () => number;
}

interface Tally { pce: number; other: number; tie: number }
const empty = (): Tally => ({ pce: 0, other: 0, tie: 0 });
const add = (t: Tally, w: Winner) => { if (w === "pce") t.pce++; else if (w === "single") t.other++; else t.tie++; };
const mean = (m: Record<string, number[]>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round((v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)) * 100) / 100]));

interface Outcome { c: GateCase; cand: PairJudgment; candG?: Winner; live: PairJudgment; liveG?: Winner }

export async function runPolishGate(cases: GateCase[], candidate: string, deps: GateDeps, opts: { maxUsd: number; concurrency?: number }) {
  const outcomes: Outcome[] = [];
  let failed = 0, skippedForBudget = 0;
  const step = opts.concurrency ?? 5;
  for (let i = 0; i < cases.length; i += step) {
    if (deps.spentUsd() >= opts.maxUsd) { skippedForBudget += cases.length - i; break; }
    await Promise.all(cases.slice(i, i + step).map(async (c) => {
      try {
        const polished = await deps.polish(candidate, c);
        const cand = await deps.judge(c, polished);
        const candG = deps.judgeGemini ? (await deps.judgeGemini(c, polished)).winner : undefined;
        let live = c.stored?.claude; let liveG = c.stored?.gemini;
        if (!live || (deps.judgeGemini && !liveG)) {
          const lp = await deps.polish(null, c);
          live = await deps.judge(c, lp);
          if (deps.judgeGemini) liveG = (await deps.judgeGemini(c, lp)).winner;
        }
        outcomes.push({ c, cand, candG, live, liveG });
      } catch { failed++; }
    }));
  }

  // Only pairs where candidate AND live were both judged count, so neither arm is advantaged by a dropped pair.
  const cand = empty(), live = empty(), gCand = empty(), gLive = empty();
  const bySet: Record<string, { n: number; cand: Tally; live: Tally }> = {};
  const dimsC: Record<string, number[]> = {}, dimsL: Record<string, number[]> = {};
  for (const o of outcomes) {
    add(cand, o.cand.winner); add(live, o.live.winner);
    if (o.candG) add(gCand, o.candG);
    if (o.liveG) add(gLive, o.liveG);
    const s = (bySet[o.c.set] ??= { n: 0, cand: empty(), live: empty() });
    s.n++; add(s.cand, o.cand.winner); add(s.live, o.live.winner);
    for (const [k, v] of Object.entries(o.cand.detail.dim_diff ?? {})) (dimsC[k] ??= []).push(v);
    for (const [k, v] of Object.entries(o.live.detail.dim_diff ?? {})) (dimsL[k] ??= []).push(v);
  }
  const dc = mean(dimsC), dl = mean(dimsL);
  const worseDims = Object.keys(dl).filter((k) => (dc[k] ?? 0) < dl[k]! - 0.15);
  const incomplete = skippedForBudget > 0 || failed > Math.max(1, Math.floor(cases.length * 0.1));
  const claudeOk = cand.pce >= live.pce + 3 && worseDims.length === 0;
  const geminiOk = Boolean(deps.judgeGemini) && gCand.pce >= gLive.pce + 2; // an independent family must also see a gain
  const verdict: "recommend" | "reject" = claudeOk && geminiOk && !incomplete ? "recommend" : "reject";
  return {
    n: outcomes.length, requested: cases.length, failed, skipped_for_budget: skippedForBudget, incomplete,
    candidate: cand, live, gemini: { candidate: gCand, live: gLive }, by_set: bySet,
    claude_ok: claudeOk, gemini_ok: geminiOk, candidate_dims: dc, live_dims: dl, worse_dims: worseDims, verdict,
    rule: "candidate PCE wins >= live wins + 3 (Claude) and >= +2 (Gemini) on the same briefs, no dimension worse than live by > 0.15, run complete; promotion still needs human approval",
  };
}
