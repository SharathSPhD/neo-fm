import { describe, expect, it, vi } from "vitest";
import { advance, type AdvanceDeps, type AgentEvent, type RunRow } from "../lib/agent/runner";
import { SpendCapError } from "../lib/agent/lyria";

function harness(events: AgentEvent[], over: Partial<AdvanceDeps> = {}) {
  let row: RunRow | null = { job_id: "j1", session_id: "s1", lyria_calls: 0, audio_path: null, status: "running" };
  const sent: { id: string; text: string; err?: boolean }[] = [];
  const deps: AdvanceDeps = {
    sessions: {
      create: vi.fn(async () => ({ id: "s1" })),
      sendOutcome: vi.fn(async () => {}),
      listEvents: vi.fn(async () => events),
      sendToolResult: vi.fn(async (_s, id, text, err) => void sent.push({ id, text, err })),
      status: vi.fn(async () => "idle"),
    },
    store: {
      get: vi.fn(async () => row),
      upsert: vi.fn(async (r) => void (row = { ...(row as RunRow), ...r })),
      claimStart: vi.fn(async () => true),
    },
    environmentId: "env", agentId: "ag", maxLyriaCalls: 1, maxOutcomeIterations: 2,
    brief: { language: "kn", styleFamily: "carnatic", targetSeconds: 30, prompt: "x" },
    music: vi.fn(async () => ({ audio: new Uint8Array(4), mimeType: "audio/mpeg", model: "m" })),
    saveAudio: vi.fn(async () => "j1/1.mp3"),
    ...over,
  };
  return { deps, sent, row: () => row };
}
const call = (id: string): AgentEvent => ({ id, type: "agent.custom_tool_use", name: "generate_music", input: { style_prompt: "s", lyrics: "l", duration_class: "clip" } });

describe("advance", () => {
  it("starts a session with an outcome kickoff when none exists", async () => {
    const h = harness([]);
    h.deps.store.get = vi.fn(async () => null);
    expect(await advance("j1", h.deps)).toBe("started");
    expect(h.deps.sessions.sendOutcome).toHaveBeenCalledOnce();
  });
  it("never creates a second session when another tick already claimed the job", async () => {
    const h = harness([]);
    h.deps.store.get = vi.fn(async () => null);
    h.deps.store.claimStart = vi.fn(async () => false);
    expect(await advance("j1", h.deps)).toBe("waiting");
    expect(h.deps.sessions.create).not.toHaveBeenCalled();
  });
  it("does not create a session when the row exists without one", async () => {
    const h = harness([]);
    h.deps.store.get = vi.fn(async () => ({ job_id: "j1", session_id: null, lyria_calls: 0, audio_path: null, status: "pending" as const }));
    expect(await advance("j1", h.deps)).toBe("waiting");
    expect(h.deps.sessions.create).not.toHaveBeenCalled();
  });
  it("propagates lookup errors instead of treating them as 'no run'", async () => {
    const h = harness([]);
    h.deps.store.get = vi.fn(async () => { throw new Error("db down"); });
    await expect(advance("j1", h.deps)).rejects.toThrow("db down");
    expect(h.deps.sessions.create).not.toHaveBeenCalled();
  });
  it("answers a pending render once, then refuses the second over the tier limit", async () => {
    const h = harness([call("e1"), call("e2")]);
    expect(await advance("j1", h.deps)).toBe("waiting");
    expect(h.deps.music).toHaveBeenCalledTimes(1);
    expect(h.sent.map((s) => s.err ?? false)).toEqual([false, true]);
  });
  it("does not re-answer calls that already have a result", async () => {
    const h = harness([call("e1"), { id: "r1", type: "user.custom_tool_result", custom_tool_use_id: "e1" }, { id: "i", type: "session.status_idle", stop_reason: { type: "end_turn" } }]);
    expect(await advance("j1", h.deps)).toBe("done");
    expect(h.deps.music).not.toHaveBeenCalled();
  });
  it("turns a spend-cap error into a refusal result, not a crash", async () => {
    const h = harness([call("e1")], { music: vi.fn(async () => { throw new SpendCapError(); }) });
    await advance("j1", h.deps);
    expect(h.sent[0]).toMatchObject({ err: true });
    expect(h.sent[0]?.text).toMatch(/budget/);
  });
  it("keeps waiting while requires_action", async () => {
    const h = harness([{ id: "i", type: "session.status_idle", stop_reason: { type: "requires_action" } }]);
    expect(await advance("j1", h.deps)).toBe("waiting");
  });
});
