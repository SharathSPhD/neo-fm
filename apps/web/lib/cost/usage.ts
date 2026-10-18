/**
 * Per-job cost recording. We store token counts and call counts, never prices: prices change, and the
 * economics report (managed-agents/ECONOMICS.md) applies them. The one exception is `list_cost`, which
 * Anthropic computes for a Managed Agents session at public list rates; it is kept verbatim in minor units.
 */
export type TokenUsage = { model: string; in: number; out: number; cache_read?: number; cache_write?: number };

export type SessionCost = {
  in: number;
  out: number;
  cache_read: number;
  cache_write: number;
  active_s: number | null;
  list_cost: { amount: string; currency: string } | null;
};

export type JobCost = {
  agent_session?: SessionCost;
  polish?: TokenUsage;
  qa?: TokenUsage;
  lyria_renders?: number;
};

const n = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);

/** Managed Agents `session.usage` (cumulative across turns) -> SessionCost; null when the API reported nothing. */
export function summariseSessionUsage(u: unknown): SessionCost | null {
  if (!u || typeof u !== "object") return null;
  const x = u as {
    input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; active_seconds?: number;
    cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
    list_cost?: { amount?: unknown; currency?: unknown } | null;
  };
  const lc = x.list_cost;
  return {
    in: n(x.input_tokens),
    out: n(x.output_tokens),
    cache_read: n(x.cache_read_input_tokens),
    cache_write: n(x.cache_creation?.ephemeral_5m_input_tokens) + n(x.cache_creation?.ephemeral_1h_input_tokens),
    active_s: typeof x.active_seconds === "number" ? x.active_seconds : null,
    list_cost: lc && typeof lc.amount === "string" && typeof lc.currency === "string" ? { amount: lc.amount, currency: lc.currency } : null,
  };
}

/** `/v1/messages` usage (Anthropic) -> TokenUsage. */
export function summariseAnthropicUsage(model: string, u: unknown): TokenUsage {
  const x = (u ?? {}) as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  return { model, in: n(x.input_tokens), out: n(x.output_tokens), cache_read: n(x.cache_read_input_tokens), cache_write: n(x.cache_creation_input_tokens) };
}

/** Gemini `usageMetadata` -> TokenUsage (thinking tokens bill as output). */
export function summariseGeminiUsage(model: string, u: unknown): TokenUsage {
  const x = (u ?? {}) as { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
  return { model, in: n(x.promptTokenCount), out: n(x.candidatesTokenCount) + n(x.thoughtsTokenCount), cache_read: n(x.cachedContentTokenCount) };
}

/** Collects what each stage reports for one job; empty parts are omitted from the stored metrics. */
export class CostCollector {
  private cost: JobCost = {};
  polish = (u: TokenUsage): void => { this.cost.polish = u; };
  qa = (u: TokenUsage): void => { this.cost.qa = u; };
  session(u: unknown): void { const s = summariseSessionUsage(u); if (s) this.cost.agent_session = s; }
  lyria(renders: number): void { if (renders > 0) this.cost.lyria_renders = renders; }
  toJSON(): JobCost { return { ...this.cost }; }
}
