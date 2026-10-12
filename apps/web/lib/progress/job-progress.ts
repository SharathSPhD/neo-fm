/**
 * Read-only helpers for the live progress view. They interpret what the pipeline has already written
 * (agent_runs columns, job_telemetry totals); nothing here changes job state.
 */
export type JobStage = "queued" | "starting" | "writing" | "polishing" | "singing" | "finishing" | "done";

export type RunSnapshot = {
  session_id: string | null;
  lyria_calls: number;
  audio_path: string | null;
  polished_lyrics: string | null;
};

/**
 * Stage of a processing job from the run row. The render slot (lyria_calls) is claimed before the Sonnet polish runs,
 * and polished_lyrics is written once polish passes the safety screen but before Lyria is called, so:
 *   claimed + no polished lyrics yet -> polishing; polished lyrics but no audio -> singing; audio saved -> finishing.
 * When polish is disabled or fails, the engine's own lyrics are sung and the song stays in "polishing" until audio exists.
 */
export function deriveStage(run: RunSnapshot | undefined): JobStage {
  if (!run) return "starting";
  if (run.audio_path) return "finishing";
  if (run.lyria_calls > 0) return run.polished_lyrics ? "singing" : "polishing";
  if (run.session_id) return "writing";
  return "starting";
}

export type Eta = { n: number; p50_s: number; p90_s: number };

const pct = (sorted: number[], p: number): number => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo]! + (sorted[Math.min(lo + 1, sorted.length - 1)]! - sorted[lo]!) * (i - lo);
};

/** Typical total time from recent finished jobs of the same plan; null until there is enough history to be honest. */
export function etaFromHistory(latenciesMs: unknown[], minSamples = 5): Eta | null {
  const xs = latenciesMs
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0)
    .map((x) => x / 1000)
    .sort((a, b) => a - b);
  if (xs.length < minSamples) return null;
  return { n: xs.length, p50_s: Math.round(pct(xs, 0.5)), p90_s: Math.round(pct(xs, 0.9)) };
}

export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.max(10, Math.round(seconds / 10) * 10)} seconds`;
  return `${Math.round(seconds / 60)} min`;
}
