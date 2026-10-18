/**
 * Tier -> Managed Agent mapping. Free users get the single-thread Haiku producer
 * (K=3, one render); paying tiers get the Sonnet coordinator with Haiku drafters,
 * an Opus polish pass and one full render. Agent IDs come from
 * `ant apply` (managed-agents/claude-lock.json) and are injected via env.
 */
export type UserTier = "free" | "creator" | "pro" | "developer";
/** `pro_fast` is the latency variant (K=4, no in-agent Opus polish); inert until MA_AGENT_ID_PRO_FAST exists and it is selected. */
export type AgentKey = "free" | "pro" | "pro_fast";

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
  pro_fast: { agent: "pro_fast", maxLyriaCalls: 1, maxOutcomeIterations: 1, userLyriaCapGbp: 3 },
};

/**
 * Monthly Lyria envelope by paid tier (GBP, ledger units: ~0.25 per full render). Sized so that at 100% use a Creator
 * (INR 299, net ~GBP 2.2) still clears ~50% margin after Claude + infra (~GBP 0.1/song): 0.75 => 3 full songs + clips.
 * Pro (INR 799, net ~GBP 5.8): 2.0 => ~8 full songs. Re-tune from measured Lyria billing (managed-agents/ECONOMICS.md).
 */
export const TIER_LYRIA_CAP_GBP: Record<UserTier, number> = { free: 0.3, creator: 0.75, pro: 2, developer: 3 };

/**
 * Paid tiers move to the fast producer only when PRO_AGENT_VARIANT=fast AND its agent exists; a per-user `agent_plan`
 * override ("pro_fast") canaries it for one account without the env flag. Anything else keeps the current producer.
 */
export function planForTier(tier: UserTier | null | undefined, override?: string | null, env: NodeJS.ProcessEnv = process.env): TierPlan {
  const fastReady = Boolean(cleanId(env.MA_AGENT_ID_PRO_FAST));
  if (override === "pro_fast") return fastReady ? PLANS.pro_fast : PLANS.pro;
  if (override === "free" || override === "pro") return PLANS[override];
  if (tier === "creator" || tier === "pro" || tier === "developer") {
    const base = env.PRO_AGENT_VARIANT === "fast" && fastReady ? PLANS.pro_fast : PLANS.pro;
    return { ...base, userLyriaCapGbp: TIER_LYRIA_CAP_GBP[tier] };
  }
  return PLANS.free;
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
  if (agent === "pro_fast") return requireId("MA_AGENT_ID_PRO_FAST", env.MA_AGENT_ID_PRO_FAST, "agent_");
  return agent === "pro"
    ? requireId("MA_AGENT_ID_PRO", env.MA_AGENT_ID_PRO, "agent_")
    : requireId("MA_AGENT_ID_FREE", env.MA_AGENT_ID_FREE, "agent_");
}
