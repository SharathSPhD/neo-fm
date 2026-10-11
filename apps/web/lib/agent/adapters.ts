import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { estimatedCostGbp, type SpendGuard } from "./lyria";
import type { AgentEvent, RunRow, RunStore, SessionApi } from "./runner";

export function serviceClient(env = process.env): SupabaseClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Managed Agents authenticate with a Console API key. Cloud dev sessions strip
 * `ANTHROPIC_API_KEY`, so prefer the dedicated `MA_ANTHROPIC_API_KEY`.
 */
export function anthropicClient(env = process.env): Anthropic {
  return new Anthropic({ apiKey: env.MA_ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY });
}

export function sessionApi(client = anthropicClient()): SessionApi {
  return {
    async create({ agentId, environmentId, title }) {
      const s = await client.beta.sessions.create({ agent: agentId, environment_id: environmentId, title });
      return { id: s.id };
    },
    async sendOutcome(sessionId, { description, rubric, maxIterations }) {
      await client.beta.sessions.events.send(sessionId, {
        events: [
          {
            type: "user.define_outcome",
            description,
            rubric: { type: "text", content: rubric },
            max_iterations: maxIterations,
          },
        ],
      });
    },
    async listEvents(sessionId) {
      const out: AgentEvent[] = [];
      for await (const e of client.beta.sessions.events.list(sessionId)) out.push(e as unknown as AgentEvent);
      return out;
    },
    async sendToolResult(sessionId, toolUseId, text) {
      const res = await client.beta.sessions.events.send(sessionId, {
        events: [{ type: "user.custom_tool_result", custom_tool_use_id: toolUseId, content: [{ type: "text", text }] }],
      });
      return JSON.stringify(res).slice(0, 400);
    },
    async sendToolConfirmation(sessionId, toolUseId, result, denyMessage) {
      await client.beta.sessions.events.send(sessionId, {
        events: [{ type: "user.tool_confirmation", tool_use_id: toolUseId, result, ...(denyMessage ? { deny_message: denyMessage } : {}) }],
      });
    },
    async status(sessionId) {
      return (await client.beta.sessions.retrieve(sessionId)).status;
    },
  };
}

export function runStore(db: SupabaseClient, agentKey: "free" | "pro"): RunStore {
  return {
    async get(jobId) {
      // Array read + first row (maybeSingle on an explicit column list returned null for an existing row).
      const { data, error } = await db.from("agent_runs").select("*").eq("job_id", jobId).limit(1);
      if (error) throw new Error(`agent_runs get: ${error.message}`);
      const r = (data ?? [])[0] as Record<string, unknown> | undefined;
      if (!r) return null;
      return {
        job_id: String(r.job_id),
        session_id: (r.session_id as string | null) ?? null,
        lyria_calls: Number(r.lyria_calls ?? 0),
        audio_path: (r.audio_path as string | null) ?? null,
        status: r.status as RunRow["status"],
      };
    },
    async claimStart(jobId) {
      const { data, error } = await db
        .from("agent_runs")
        .upsert({ job_id: jobId, agent_key: agentKey }, { onConflict: "job_id", ignoreDuplicates: true })
        .select("job_id");
      if (error) throw new Error(`agent_runs claim: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async upsert(row) {
      const { error } = await db.from("agent_runs").upsert({ agent_key: agentKey, updated_at: new Date().toISOString(), ...row }, { onConflict: "job_id" });
      if (error) throw new Error(`agent_runs upsert: ${error.message}`);
    },
  };
}

export function spendGuard(db: SupabaseClient, env = process.env): SpendGuard {
  const cap = Number(env.LYRIA_BUDGET_GBP ?? "3");
  // Reserve/release amounts are the same estimate used by generateMusic().
  return {
    async reserve(amount) {
      const { data, error } = await db.rpc("reserve_spend", { p_provider: "lyria", p_amount: amount, p_cap: cap });
      if (error) throw new Error(`reserve_spend: ${error.message}`);
      return data === true;
    },
    async release(amount) {
      await db.rpc("release_spend", { p_provider: "lyria", p_amount: amount });
    },
  };
}

export { estimatedCostGbp };
