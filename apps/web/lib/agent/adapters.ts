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

export function sessionApi(client = new Anthropic()): SessionApi {
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
      await client.beta.sessions.events.send(sessionId, {
        events: [{ type: "user.custom_tool_result", custom_tool_use_id: toolUseId, content: [{ type: "text", text }] }],
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
      const { data } = await db.from("agent_runs").select("job_id,session_id,lyria_calls,audio_path,status").eq("job_id", jobId).maybeSingle();
      return (data as RunRow | null) ?? null;
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
