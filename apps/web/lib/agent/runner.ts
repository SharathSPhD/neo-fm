/**
 * Stateless Managed-Agents job runner. `advance()` is idempotent and meant to be
 * called repeatedly (cron / after-create): it starts the session, answers any
 * pending `generate_music` custom-tool calls, and reports when the run is done.
 * All I/O is injected so it is unit-testable without network access.
 */
import type { DurationClass, LyriaResult } from "./lyria";
import { SpendCapError } from "./lyria";

export interface AgentEvent {
  id: string;
  type: string;
  name?: string;
  input?: unknown;
  custom_tool_use_id?: string;
  stop_reason?: { type: string };
}

export interface SessionApi {
  create(args: { agentId: string; environmentId: string; title: string }): Promise<{ id: string }>;
  sendOutcome(sessionId: string, args: { description: string; rubric: string; maxIterations: number }): Promise<void>;
  listEvents(sessionId: string): Promise<AgentEvent[]>;
  sendToolResult(sessionId: string, toolUseId: string, text: string, isError?: boolean): Promise<void>;
  status(sessionId: string): Promise<string>;
}

export interface RunRow {
  job_id: string;
  session_id: string | null;
  lyria_calls: number;
  audio_path: string | null;
  status: "pending" | "running" | "done" | "failed";
}

export interface RunStore {
  get(jobId: string): Promise<RunRow | null>;
  upsert(row: Partial<RunRow> & { job_id: string }): Promise<void>;
}

export interface Brief {
  language: string;
  styleFamily: string;
  targetSeconds: number;
  prompt: string;
}

export const RUBRIC = `# neo-fm song rubric - starter, tune the criteria
- /mnt/session/outputs/lyrics.md exists and is entirely in the requested language and script
- lyrics.md is sectioned to match the style family and contains no commentary or markdown inside lyric lines
- /mnt/session/outputs/cascade_audit.json lists every candidate with apohana, ananda and posterior scores and the selected index
- /mnt/session/outputs/song_document.json is valid JSON with language, style_family, target_duration_seconds, title, sections[] and style_prompt
- No line from the must_avoid list appears in the lyrics
- generate_music was called and its result (or an explicit host refusal) is reported in the final summary
`;

export function briefText(b: Brief): string {
  return [
    `Brief: ${b.prompt}`,
    `Language: ${b.language}`,
    `Style family: ${b.styleFamily}`,
    `Target duration: ${b.targetSeconds}s`,
  ].join("\n");
}

export interface AdvanceDeps {
  sessions: SessionApi;
  store: RunStore;
  environmentId: string;
  agentId: string;
  maxLyriaCalls: number;
  maxOutcomeIterations: number;
  brief: Brief;
  music: (a: { stylePrompt: string; lyrics: string; durationClass: DurationClass }) => Promise<LyriaResult>;
  saveAudio: (jobId: string, n: number, r: LyriaResult) => Promise<string>;
}

export type AdvanceResult = "started" | "waiting" | "done";

export async function advance(jobId: string, d: AdvanceDeps): Promise<AdvanceResult> {
  let run = await d.store.get(jobId);
  if (!run?.session_id) {
    const s = await d.sessions.create({ agentId: d.agentId, environmentId: d.environmentId, title: `neo-fm job ${jobId}` });
    await d.store.upsert({ job_id: jobId, session_id: s.id, status: "running", lyria_calls: 0 });
    await d.sessions.sendOutcome(s.id, {
      description: briefText(d.brief),
      rubric: RUBRIC,
      maxIterations: d.maxOutcomeIterations,
    });
    return "started";
  }
  if (run.status === "done" || run.status === "failed") return "done";

  const sid = run.session_id;
  const events = await d.sessions.listEvents(sid);
  const answered = new Set(events.filter((e) => e.type === "user.custom_tool_result").map((e) => e.custom_tool_use_id));
  const pending = events.filter((e) => e.type === "agent.custom_tool_use" && e.name === "generate_music" && !answered.has(e.id));

  for (const call of pending) {
    run = (await d.store.get(jobId)) ?? run;
    if (run.lyria_calls >= d.maxLyriaCalls) {
      await d.sessions.sendToolResult(sid, call.id, "Refused: render limit for this tier reached. Finish with the lyrics you have.", true);
      continue;
    }
    const inp = call.input as { style_prompt?: string; lyrics?: string; duration_class?: DurationClass };
    if (!inp?.style_prompt || !inp.lyrics || (inp.duration_class !== "clip" && inp.duration_class !== "full")) {
      await d.sessions.sendToolResult(sid, call.id, "Invalid input: style_prompt, lyrics and duration_class (clip|full) are required.", true);
      continue;
    }
    // Count the attempt first so a crash between render and reply cannot double-spend.
    await d.store.upsert({ job_id: jobId, lyria_calls: run.lyria_calls + 1 });
    try {
      const r = await d.music({ stylePrompt: inp.style_prompt, lyrics: inp.lyrics, durationClass: inp.duration_class });
      const path = await d.saveAudio(jobId, run.lyria_calls + 1, r);
      await d.store.upsert({ job_id: jobId, audio_path: path });
      await d.sessions.sendToolResult(sid, call.id, `Rendered ${r.model} (${r.mimeType}, ${r.audio.byteLength} bytes). Stored.`);
    } catch (e) {
      const msg = e instanceof SpendCapError ? "Refused: spend budget reached. Finish with the lyrics you have." : "Render failed; do not retry.";
      await d.sessions.sendToolResult(sid, call.id, msg, true);
    }
  }
  if (pending.length > 0) return "waiting";

  const idle = events.some((e) => e.type === "session.status_idle" && e.stop_reason?.type !== "requires_action");
  const terminated = events.some((e) => e.type === "session.status_terminated");
  if ((idle && (await d.sessions.status(sid)) === "idle") || terminated) {
    await d.store.upsert({ job_id: jobId, status: terminated && !idle ? "failed" : "done" });
    return "done";
  }
  return "waiting";
}
