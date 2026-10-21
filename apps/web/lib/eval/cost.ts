/**
 * Spend estimate and meter for the offline eval gate (self-improve evaluate, pce-eval).
 * Rates are USD per million tokens and ASSUMED list prices: override with EVAL_RATES_JSON
 * ({"claude-sonnet-5-5":{"in":2,"out":10}}) and calibrate against the `spend` block the gate reports after a run.
 */
export interface Rate { in: number; out: number }

const DEFAULT_RATES: Record<string, Rate> = {
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "claude-opus-5-5": { in: 4, out: 20 },
};

export function rates(env: NodeJS.ProcessEnv = process.env): Record<string, Rate> {
  try {
    if (env.EVAL_RATES_JSON) return { ...DEFAULT_RATES, ...(JSON.parse(env.EVAL_RATES_JSON) as Record<string, Rate>) };
  } catch { /* fall back to defaults */ }
  return DEFAULT_RATES;
}

/** Per-call token profile of one 30 s Indic lyric pair (Indic scripts tokenize heavily; measure and recalibrate). */
const POLISH = { in: 800, out: 500 };
const JUDGE = { in: 1600, out: 260 }; // one judge call; each pair is judged in both orders
const BEST_OF_SIX = { haiku: { in: 6 * 150, out: 6 * 500 }, sonnet: { in: 6 * 500 + 300, out: 500 } };
const PCE_SESSION = { in: 20_000, out: 6_000 }; // lyrics-only Haiku managed session (agent loop + engine tool calls)
const PROPOSER = { in: 9_000, out: 2_500 };

const usd = (r: Rate, t: { in: number; out: number }) => (t.in * r.in + t.out * r.out) / 1e6;

export interface GateEstimateInput {
  /** briefs polished with the candidate */
  briefs: number;
  /** briefs whose live-template result is not stored and must be recomputed (polish + judge again) */
  liveRecompute: number;
  /** briefs that still need a PCE arm + baseline built first (occasion set, first run only) */
  seedBriefs?: number;
}

export interface GateEstimate {
  claude_usd: number;
  breakdown: Record<string, number>;
  gemini_calls: number;
  assumptions: string;
}

export function estimateGate(i: GateEstimateInput, r = rates()): GateEstimate {
  const sonnet = r["claude-sonnet-5-5"]!, haiku = r["claude-haiku-5-5"]!;
  const pair = (n: number) => n * (usd(sonnet, POLISH) + 2 * usd(sonnet, JUDGE));
  const seed = i.seedBriefs ?? 0;
  const b = {
    candidate_polish_and_judge: pair(i.briefs),
    live_recompute: pair(i.liveRecompute),
    seed_pce_sessions: seed * usd(haiku, PCE_SESSION),
    seed_baseline_best_of_6: seed * (usd(haiku, BEST_OF_SIX.haiku) + usd(sonnet, BEST_OF_SIX.sonnet)),
  };
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    claude_usd: round(Object.values(b).reduce((a, x) => a + x, 0)),
    breakdown: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, round(v)])),
    gemini_calls: 2 * (i.briefs + i.liveRecompute),
    assumptions: "token profile per brief: polish 800 in/500 out, judge 1600 in/260 out x2 orders; list prices; Gemini billed separately (not Claude credit)",
  };
}

export function proposerUsd(r = rates()): number {
  return Math.round(usd(r["claude-opus-5-5"]!, PROPOSER) * 1000) / 1000;
}

/** Counts real usage during a gate run so the estimate can be recalibrated. Reset at the start of each admin request. */
class Meter {
  private by = new Map<string, { calls: number; in: number; out: number }>();
  reset() { this.by.clear(); }
  record(model: string, u?: { input_tokens?: number; output_tokens?: number } | null) {
    const e = this.by.get(model) ?? { calls: 0, in: 0, out: 0 };
    e.calls++; e.in += u?.input_tokens ?? 0; e.out += u?.output_tokens ?? 0;
    this.by.set(model, e);
  }
  usd(r = rates()): number {
    let t = 0;
    for (const [m, e] of this.by) { const rt = r[m]; if (rt) t += usd(rt, e); }
    return Math.round(t * 1000) / 1000;
  }
  snapshot(r = rates()) { return { claude_usd: this.usd(r), by_model: Object.fromEntries(this.by) }; }
}
export const meter = new Meter();
