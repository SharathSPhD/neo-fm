/**
 * Host-side counterpart of runner.advance(): same run row, render slot, spend and circuit-breaker rules, but the lyrics come
 * from hostCascade() instead of a Managed Agents session, so one call takes the job from brief to stored audio.
 * Re-entrant: a retry (breaker open, function killed) reuses the saved song instead of paying for the cascade again.
 */
import { SpendCapError } from "../agent/lyria";
import type { AdvanceDeps, AdvanceResult, RunStore } from "../agent/runner";
import { hostCascade, type HostBrief, type HostCascadeDeps, type HostSong } from "./host-cascade";

export interface HostRunDeps {
  store: RunStore;
  maxLyriaCalls: number;
  brief: HostBrief;
  cascade: HostCascadeDeps;
  /** The saved song of an earlier attempt, if any. */
  loadSong: () => Promise<HostSong | null>;
  /** Persist lyrics/title/style before the paid render so they survive a failed or interrupted one. */
  saveSong: (s: HostSong) => Promise<void>;
  music: AdvanceDeps["music"];
  saveAudio: AdvanceDeps["saveAudio"];
  gate?: () => string | null;
  gateRelease?: () => void;
  timed?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  log?: (message: string) => void;
}

export async function hostAdvance(jobId: string, d: HostRunDeps): Promise<AdvanceResult> {
  const timed = d.timed ?? (<T,>(_n: string, fn: () => Promise<T>) => fn());
  const run = await d.store.get(jobId);
  if (run && (run.status === "done" || run.status === "failed" || run.audio_path)) {
    if (run.status === "running" && run.audio_path) await d.store.upsert({ job_id: jobId, status: "done" });
    return "done";
  }
  if (!run) {
    if (!(await d.store.claimStart(jobId))) return "waiting";
    await d.store.upsert({ job_id: jobId, status: "running" });
  }

  let song = await d.loadSong();
  if (!song) {
    song = await timed("agent_draft", () => hostCascade(d.brief, d.cascade));
    await d.saveSong(song);
  } else d.log?.("reusing saved song");

  const blocked = d.gate?.();
  if (blocked) { d.log?.(`render deferred: ${blocked}`); return "waiting"; }
  const slot = await d.store.claimRender(jobId, d.maxLyriaCalls);
  if (slot === null) {
    d.gateRelease?.();
    await d.store.upsert({ job_id: jobId, render_error: "render limit for this tier reached", status: "failed" });
    return "done";
  }
  try {
    const r = await d.music({ stylePrompt: song.stylePrompt, lyrics: song.lyrics, durationClass: d.brief.targetSeconds <= 30 ? "clip" : "full", targetSeconds: d.brief.targetSeconds });
    const path = await d.saveAudio(jobId, slot, r);
    await d.store.upsert({ job_id: jobId, audio_path: path, status: "done" });
  } catch (e) {
    if (e instanceof SpendCapError) d.gateRelease?.();
    await d.store.upsert({ job_id: jobId, render_error: (e instanceof Error ? e.message : String(e)).slice(0, 400), status: "failed" });
    d.log?.(`render path failed (${e instanceof Error ? e.message.slice(0, 120) : "?"})`);
  }
  return "done";
}
