/**
 * Tier -> Managed Agent mapping. Free users get the single-thread Haiku producer
 * (K=3, one render); paying tiers get the Sonnet coordinator with Haiku drafters,
 * an Opus polish pass and one full render. Agent IDs come from
 * `ant apply` (managed-agents/claude-lock.json) and are injected via env.
 */
export type UserTier = "free" | "creator" | "pro" | "developer";
export type AgentKey = "free" | "pro";

export interface TierPlan {
  agent: AgentKey;
  maxLyriaCalls: number;
  /** Cap on a single outcome grading loop; each iteration costs tokens. */
  maxOutcomeIterations: number;
  /** Monthly Lyria spend envelope per user (GBP), enforced atomically with the shared ceiling. */
  userLyriaCapGbp: number;
}

const PLANS: Record<AgentKey, TierPlan> = {
  free: { agent: "free", maxLyriaCalls: 1, maxOutcomeIterations: 1, userLyriaCapGbp: 0.3 },
  // One full render: a throwaway clip-then-full pair doubled Lyria cost and added serial latency.
  pro: { agent: "pro", maxLyriaCalls: 1, maxOutcomeIterations: 1, userLyriaCapGbp: 3 },
};

export function planForTier(tier: UserTier | null | undefined, override?: string | null): TierPlan {
  if (override === "free" || override === "pro") return PLANS[override];
  return tier === "creator" || tier === "pro" || tier === "developer"
    ? PLANS.pro
    : PLANS.free;
}

/** Dashboard-pasted IDs often carry whitespace or wrapping quotes; strip them. */
export function cleanId(v: string | undefined): string {
  return (v ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
}

/** Returns a cleaned ID or throws a message that names the problem without echoing the value. */
export function requireId(name: string, v: string | undefined, prefix: "agent_" | "env_"): string {
  const id = cleanId(v);
  if (!id) throw new Error(`Missing ${name}`);
  if (!id.startsWith(prefix) || !/^[A-Za-z0-9_]+$/.test(id)) {
    throw new Error(`${name} is malformed: expected ${prefix}..., got "${id.slice(0, 6)}..." (length ${id.length})`);
  }
  return id;
}

export function agentIdFor(agent: AgentKey, env = process.env): string {
  return agent === "pro"
    ? requireId("MA_AGENT_ID_PRO", env.MA_AGENT_ID_PRO, "agent_")
    : requireId("MA_AGENT_ID_FREE", env.MA_AGENT_ID_FREE, "agent_");
}
