import { mulberry32, sampleBeta, shrink, type Posterior } from "./bandit";

/**
 * Harness arms the policy may choose between. Each maps onto levers that already exist (lib/lyrics/harness/harness.ts ARMS,
 * lib/lyrics/premium.ts); the policy never invents a prompt. An arm reaches live traffic only after it has passed the eval gate
 * and an operator has added it to harness_policy.
 */
export interface PolicyArm { id: string; exemplars: number; playbook: boolean; model?: "opus" }
export const POLICY_ARMS: Record<string, PolicyArm> = {
  live: { id: "live", exemplars: 0, playbook: false },
  refs: { id: "refs", exemplars: 3, playbook: true },
  refs_opus: { id: "refs_opus", exemplars: 3, playbook: true, model: "opus" },
};
const PAID_TIERS = new Set(["creator", "pro", "developer"]);

/** One row of harness_policy: an arm an operator has promoted for a language and tier ("*" matches any tier). */
export interface PolicyRow { language: string; tier: string; arm_id: string; role: "champion" | "challenger"; max_share: number }
export interface StatRow { arm_id: string; a: number; b: number }

export interface Pick { arm: PolicyArm; source: "policy" | "flags"; reason: string }

export const policyEnabled = (env: Record<string, string | undefined>): boolean => env.HARNESS_POLICY === "1";

/** What the env flags alone would do today; the answer whenever the policy is off, empty or unreadable. */
export function flagArm(env: Record<string, string | undefined>, language: string, premiumModel: string | undefined): PolicyArm {
  if (premiumModel) return POLICY_ARMS.refs_opus!;
  const langs = (env.PCE_HARNESS_REFS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return langs.includes(language) ? POLICY_ARMS.refs! : POLICY_ARMS.live!;
}

export interface PickInput {
  env: Record<string, string | undefined>;
  language: string;
  tier: string;
  rows: PolicyRow[];
  /** language-level posteriors (the prior) */
  global: StatRow[];
  /** this listener's own posteriors; empty for anonymous or non-consenting users */
  user: StatRow[];
  premiumModel?: string;
  seed: number;
}

export function pickArm(i: PickInput): Pick {
  const fallback = (reason: string): Pick => ({ arm: flagArm(i.env, i.language, i.premiumModel), source: "flags", reason });
  if (!policyEnabled(i.env)) return fallback("HARNESS_POLICY off");
  const rows = i.rows.filter((r) => r.language === i.language && (r.tier === i.tier || r.tier === "*") && POLICY_ARMS[r.arm_id]);
  // Opus arms are paid-tier only: a Free listener never gets one, whatever the table says.
  const eligible = rows.filter((r) => !POLICY_ARMS[r.arm_id]!.model || PAID_TIERS.has(i.tier));
  if (eligible.length === 0) return fallback("no policy rows for this language and tier");
  if (eligible.length === 1) return { arm: POLICY_ARMS[eligible[0]!.arm_id]!, source: "policy", reason: "single promoted arm" };

  const rng = mulberry32(i.seed);
  const g = new Map(i.global.map((s) => [s.arm_id, s]));
  const u = new Map(i.user.map((s) => [s.arm_id, s]));
  // A challenger is sampled at most max_share of the time: draw once to decide whether it is allowed in this round.
  const challengerOk = (r: PolicyRow) => r.role === "champion" || rng() < r.max_share;
  const entrants = eligible.filter(challengerOk);
  const pool = entrants.length ? entrants : eligible.filter((r) => r.role === "champion");
  let best = pool[0]!;
  let bestScore = -1;
  for (const r of pool) {
    const prior: Posterior = g.get(r.arm_id) ?? { a: 1, b: 1 };
    const post = shrink(u.get(r.arm_id), prior);
    const s = sampleBeta(post, rng);
    if (s > bestScore) { bestScore = s; best = r; }
  }
  return { arm: POLICY_ARMS[best.arm_id]!, source: "policy", reason: `thompson over ${pool.map((r) => r.arm_id).join(",")}` };
}

/** Stable per-job seed so a retried job keeps the arm it started with. */
export function seedFor(jobId: string): number {
  let h = 2166136261;
  for (let k = 0; k < jobId.length; k++) { h ^= jobId.charCodeAt(k); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
