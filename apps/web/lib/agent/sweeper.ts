/**
 * Stuck-job sweeper. A job that sits in `processing` past STUCK_AFTER_MS (agent session wedged, worker died,
 * provider never answered) is failed with a friendly code and its leaked Lyria reservation is given back.
 * All I/O is injected so the chaos tests run without a database.
 */
import { estimatedCostGbp } from "./lyria";
import type { SupabaseClient } from "@supabase/supabase-js";

export const STUCK_AFTER_MS = 15 * 60_000;
export const STUCK_CODE = "timed_out";

export interface StuckCandidate {
  id: string;
  user_id: string;
  started_at: string | null;
  agent_lease_until: string | null;
  target_seconds: number;
}

export interface SweepRun {
  audio_path: string | null;
  lyria_calls: number;
  render_error: string | null;
}

export interface SweepDeps {
  listProcessing(): Promise<StuckCandidate[]>;
  getRun(jobId: string): Promise<SweepRun | null>;
  /** Conditional on status = 'processing'; true only for the caller that actually failed the job. */
  failJob(jobId: string, code: string): Promise<boolean>;
  markRunFailed(jobId: string): Promise<void>;
  releaseSpend(userId: string, amountGbp: number): Promise<void>;
  now?: () => number;
}

export type SweepOutcome = "failed" | "skipped_young" | "skipped_leased" | "skipped_has_audio" | "skipped_raced";

export async function sweepStuckJobs(deps: SweepDeps, opts: { stuckAfterMs?: number } = {}): Promise<Record<string, SweepOutcome>> {
  const now = (deps.now ?? Date.now)();
  const limit = opts.stuckAfterMs ?? STUCK_AFTER_MS;
  const out: Record<string, SweepOutcome> = {};
  for (const j of await deps.listProcessing()) {
    const started = j.started_at ? new Date(j.started_at).getTime() : now;
    if (now - started < limit) { out[j.id] = "skipped_young"; continue; }
    // A live lease means a worker is on it right now; the next tick sweeps it once the lease lapses.
    if (j.agent_lease_until && new Date(j.agent_lease_until).getTime() > now) { out[j.id] = "skipped_leased"; continue; }
    const run = await deps.getRun(j.id);
    // Audio exists: finalize() will complete the job; failing it would throw away a paid render.
    if (run?.audio_path) { out[j.id] = "skipped_has_audio"; continue; }
    if (!(await deps.failJob(j.id, STUCK_CODE))) { out[j.id] = "skipped_raced"; continue; }
    await deps.markRunFailed(j.id).catch(() => {});
    // A render slot was taken but neither audio nor a render error was recorded: the worker died between
    // reserve and result, so generateMusic never reached its own release.
    if (run && run.lyria_calls > 0 && !run.render_error) {
      await deps.releaseSpend(j.user_id, estimatedCostGbp(j.target_seconds > 35 ? "full" : "clip"));
    }
    out[j.id] = "failed";
  }
  return out;
}

export function sweepDeps(db: SupabaseClient): SweepDeps {
  return {
    async listProcessing() {
      const { data, error } = await db.from("jobs").select("id,user_id,started_at,agent_lease_until,song_document_id").eq("status", "processing");
      if (error) throw new Error(`sweep jobs query: ${error.message}`);
      const rows = (data ?? []) as { id: string; user_id: string; started_at: string | null; agent_lease_until: string | null; song_document_id: string }[];
      const secs = new Map<string, number>();
      if (rows.length) {
        const { data: docs } = await db.from("song_documents").select("id,document_json").in("id", rows.map((r) => r.song_document_id));
        for (const d of (docs ?? []) as { id: string; document_json: { target_duration_seconds?: number } }[]) secs.set(d.id, d.document_json?.target_duration_seconds ?? 30);
      }
      return rows.map((r) => ({ id: r.id, user_id: r.user_id, started_at: r.started_at, agent_lease_until: r.agent_lease_until, target_seconds: secs.get(r.song_document_id) ?? 30 }));
    },
    async getRun(jobId) {
      const { data, error } = await db.from("agent_runs").select("audio_path,lyria_calls,render_error").eq("job_id", jobId).limit(1);
      if (error) throw new Error(`sweep agent_runs: ${error.message}`);
      const r = (data ?? [])[0] as { audio_path: string | null; lyria_calls: number | null; render_error: string | null } | undefined;
      return r ? { audio_path: r.audio_path, lyria_calls: Number(r.lyria_calls ?? 0), render_error: r.render_error ?? null } : null;
    },
    async failJob(jobId, code) {
      const { data } = await db.from("jobs").update({ status: "failed", error: code, finished_at: new Date().toISOString() }).eq("id", jobId).eq("status", "processing").select("id");
      return (data ?? []).length > 0;
    },
    async markRunFailed(jobId) {
      await db.from("agent_runs").update({ status: "failed", render_error: STUCK_CODE }).eq("job_id", jobId);
    },
    async releaseSpend(userId, amount) {
      await db.rpc("release_user_spend", { p_user: userId, p_provider: "lyria", p_amount: amount, p_period: new Date().toISOString().slice(0, 7) + "-01" });
    },
  };
}
