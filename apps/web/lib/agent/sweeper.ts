/**
 * Stuck-job sweeper. A job is stuck only when it is old AND shows no progress: job age over MIN_AGE_MS and the
 * run's `updated_at` (or, with no run row, the job itself) untouched for NO_PROGRESS_MS. Age alone never fails a job:
 * slow Pro jobs legitimately stay in `processing` for close to an hour. A stuck job is failed with a friendly code and
 * its leaked Lyria reservation is given back.
 * All I/O is injected so the chaos tests run without a database.
 */
import { estimatedCostGbp } from "./lyria";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Never touch a job younger than this. */
export const MIN_AGE_MS = 30 * 60_000;
/** ...and only if its run has not been updated for this long. */
export const NO_PROGRESS_MS = 20 * 60_000;
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
  updated_at: string | null;
}

export interface SweepDeps {
  listProcessing(): Promise<StuckCandidate[]>;
  getRun(jobId: string): Promise<SweepRun | null>;
  /**
   * Atomically take the job's lease, only while status = 'processing' and no live lease exists (same compare-and-set the
   * workers use). While the sweeper holds it no worker can advance or finalize the job. False when a worker got there first.
   */
  claim(jobId: string): Promise<boolean>;
  /** Give the lease back without failing the job (used when a re-check under the lease shows the job is alive). */
  unclaim(jobId: string): Promise<void>;
  /** Conditional on status = 'processing'; clears the lease; true only for the caller that actually failed the job. */
  failJob(jobId: string, code: string): Promise<boolean>;
  markRunFailed(jobId: string): Promise<void>;
  /** `periodStart` is the job's own month (YYYY-MM-01), the month its reservation was made in. */
  releaseSpend(userId: string, amountGbp: number, periodStart: string): Promise<void>;
  now?: () => number;
}

export type SweepOutcome = "failed" | "skipped_young" | "skipped_progressing" | "skipped_leased" | "skipped_has_audio" | "skipped_raced";

function periodOf(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export async function sweepStuckJobs(deps: SweepDeps, opts: { minAgeMs?: number; noProgressMs?: number } = {}): Promise<Record<string, SweepOutcome>> {
  const now = (deps.now ?? Date.now)();
  const minAge = opts.minAgeMs ?? MIN_AGE_MS;
  const noProgress = opts.noProgressMs ?? NO_PROGRESS_MS;
  const out: Record<string, SweepOutcome> = {};
  for (const j of await deps.listProcessing()) {
    const started = j.started_at ? new Date(j.started_at).getTime() : now;
    if (now - started < minAge) { out[j.id] = "skipped_young"; continue; }
    // A live lease means a worker is on it right now; the next tick sweeps it once the lease lapses.
    if (j.agent_lease_until && new Date(j.agent_lease_until).getTime() > now) { out[j.id] = "skipped_leased"; continue; }
    const check = (run: SweepRun | null): SweepOutcome | null => {
      // Audio exists: finalize() will complete the job; failing it would throw away a paid render.
      if (run?.audio_path) return "skipped_has_audio";
      // Progress check: the run row is touched whenever the worker advances the job. Recent touch = still moving.
      const lastTouch = run?.updated_at ? new Date(run.updated_at).getTime() : started;
      if (now - lastTouch < noProgress) return "skipped_progressing";
      return null;
    };
    const first = check(await deps.getRun(j.id));
    if (first) { out[j.id] = first; continue; }
    // Take the lease BEFORE the decisive re-read: a worker that wakes between our checks and the update cannot then
    // save audio or finalize behind our back, and one that already did is seen by the re-read below.
    if (!(await deps.claim(j.id))) { out[j.id] = "skipped_raced"; continue; }
    const run = await deps.getRun(j.id);
    const second = check(run);
    if (second) { await deps.unclaim(j.id).catch(() => {}); out[j.id] = second; continue; }
    if (!(await deps.failJob(j.id, STUCK_CODE))) { out[j.id] = "skipped_raced"; continue; }
    await deps.markRunFailed(j.id).catch(() => {});
    // A render slot was taken but neither audio nor a render error was recorded: the worker died between
    // reserve and result, so generateMusic never reached its own release.
    if (run && run.lyria_calls > 0 && !run.render_error) {
      // Amount comes from the stored run: one estimate per taken render slot. The duration class is not persisted, so it
      // follows the agent's own rule (clip for targets up to 30 s, otherwise full).
      await deps.releaseSpend(j.user_id, run.lyria_calls * estimatedCostGbp(j.target_seconds > 30 ? "full" : "clip"), periodOf(j.started_at ?? new Date(now).toISOString()));
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
      const { data, error } = await db.from("agent_runs").select("audio_path,lyria_calls,render_error,updated_at").eq("job_id", jobId).limit(1);
      if (error) throw new Error(`sweep agent_runs: ${error.message}`);
      const r = (data ?? [])[0] as { audio_path: string | null; lyria_calls: number | null; render_error: string | null; updated_at: string | null } | undefined;
      return r ? { audio_path: r.audio_path, lyria_calls: Number(r.lyria_calls ?? 0), render_error: r.render_error ?? null, updated_at: r.updated_at ?? null } : null;
    },
    async claim(jobId) {
      const now = new Date();
      const until = new Date(now.getTime() + 60_000).toISOString();
      const { data } = await db
        .from("jobs")
        .update({ agent_lease_until: until })
        .eq("id", jobId)
        .eq("status", "processing")
        .or(`agent_lease_until.is.null,agent_lease_until.lt.${now.toISOString()}`)
        .select("id");
      return (data ?? []).length > 0;
    },
    async unclaim(jobId) {
      await db.from("jobs").update({ agent_lease_until: null }).eq("id", jobId).eq("status", "processing");
    },
    async failJob(jobId, code) {
      const { data } = await db.from("jobs").update({ status: "failed", error: code, finished_at: new Date().toISOString(), agent_lease_until: null }).eq("id", jobId).eq("status", "processing").select("id");
      return (data ?? []).length > 0;
    },
    async markRunFailed(jobId) {
      await db.from("agent_runs").update({ status: "failed", render_error: STUCK_CODE }).eq("job_id", jobId);
    },
    async releaseSpend(userId, amount, periodStart) {
      await db.rpc("release_user_spend", { p_user: userId, p_provider: "lyria", p_amount: amount, p_period: periodStart });
    },
  };
}
