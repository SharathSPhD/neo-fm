/**
 * Tier -> Managed Agent mapping. Free users get the single-thread Haiku producer
 * (K=3, one render); paying tiers get the Sonnet coordinator with Haiku drafters,
 * an Opus polish pass and a draft+final render. Agent IDs come from
 * `ant apply` (managed-agents/claude-lock.json) and are injected via env.
 */
export type UserTier = "free" | "creator" | "pro" | "developer";
export type AgentKey = "free" | "pro";

export interface TierPlan {
  agent: AgentKey;
  maxLyriaCalls: number;
  /** Cap on a single outcome grading loop; each iteration costs tokens. */
  maxOutcomeIterations: number;
}

const PLANS: Record<AgentKey, TierPlan> = {
  free: { agent: "free", maxLyriaCalls: 1, maxOutcomeIterations: 2 },
  pro: { agent: "pro", maxLyriaCalls: 2, maxOutcomeIterations: 3 },
};

export function planForTier(tier: UserTier | null | undefined): TierPlan {
  return tier === "creator" || tier === "pro" || tier === "developer"
    ? PLANS.pro
    : PLANS.free;
}

export function agentIdFor(agent: AgentKey, env = process.env): string {
  const id = agent === "pro" ? env.MA_AGENT_ID_PRO : env.MA_AGENT_ID_FREE;
  if (!id) throw new Error(`Missing MA_AGENT_ID_${agent.toUpperCase()}`);
  return id;
}
