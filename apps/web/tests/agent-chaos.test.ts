import { describe, expect, it, vi } from "vitest";
import { advance, type AdvanceDeps, type AgentEvent, type RunRow } from "../lib/agent/runner";
import { generateMusic, type SpendGuard } from "../lib/agent/lyria";
import { releaseLease, takeLease } from "../lib/agent/process";
import { MIN_AGE_MS, NO_PROGRESS_MS, STUCK_CODE, sweepStuckJobs, type StuckCandidate, type SweepDeps, type SweepRun } from "../lib/agent/sweeper";
import { friendlyJobError } from "../components/job-progress";

// ---- minimal in-memory `jobs` table that honours takeLease's conditional update ----
function leaseDb(initial: string | null) {
  const row = { id: "j1", agent_lease_until: initial as string | null };
  const db = {
    from: () => ({
      update: (patch: { agent_lease_until: string | null }) => {
        let cond: ((now: string) => boolean) | null = null;
        const q = {
          eq: () => q,
          or: (expr: string) => {
            const lt = /lt\.(.+)$/.exec(expr)![1] ?? "";
            cond = () => row.agent_lease_until === null || row.agent_lease_until < lt;
            return q;
          },
          select: async () => {
            if (cond && !cond("")) return { data: [] };
            row.agent_lease_until = patch.agent_lease_until;
            return { data: [{ id: row.id }] };
          },
          then: (res: (v: unknown) => void) => { row.agent_lease_until = patch.agent_lease_until; res({}); },
        };
        return q;
      },
    }),
  };
  return { db: db as never, row };
}

describe("lease chaos", () => {
  it("lets exactly one of two simultaneous ticks take the lease", async () => {
    const { db } = leaseDb(null);
    const got = [await takeLease(db, "j1"), await takeLease(db, "j1")];
    expect(got).toEqual([true, false]);
  });
  it("takes over a lease that expired (worker died mid-run)", async () => {
    const { db } = leaseDb(new Date(Date.now() - 1000).toISOString());
    expect(await takeLease(db, "j1")).toBe(true);
  });
  it("refuses a live lease and frees it on release", async () => {
    const { db, row } = leaseDb(new Date(Date.now() + 60_000).toISOString());
    expect(await takeLease(db, "j1")).toBe(false);
    await releaseLease(db, "j1");
    expect(row.agent_lease_until).toBeNull();
    expect(await takeLease(db, "j1")).toBe(true);
  });
});

// ---- double tick through advance() ----
function harness(events: AgentEvent[], over: Partial<AdvanceDeps> = {}) {
  let row: RunRow | null = { job_id: "j1", session_id: "s1", lyria_calls: 0, audio_path: null, status: "running" };
  const deps: AdvanceDeps = {
    sessions: {
      create: vi.fn(async () => ({ id: "s1" })), sendOutcome: vi.fn(async () => {}),
      listEvents: vi.fn(async () => events), sendToolResult: vi.fn(async () => {}),
      sendToolConfirmation: vi.fn(async () => {}), status: vi.fn(async () => "running"),
    },
    store: {
      get: vi.fn(async () => row),
      upsert: vi.fn(async (r) => void (row = { ...(row as RunRow), ...r })),
      claimStart: vi.fn(async () => true),
      claimRender: vi.fn(async (_j: string, max: number) => { const n = (row?.lyria_calls ?? 0) + 1; if (n > max) return null; row = { ...(row as RunRow), lyria_calls: n }; return n; }),
    },
    environmentId: "env", agentId: "ag", maxLyriaCalls: 1, maxOutcomeIterations: 2,
    brief: { language: "hi", styleFamily: "x", targetSeconds: 30, prompt: "p" },
    music: vi.fn(async () => ({ audio: new Uint8Array(4), mimeType: "audio/mpeg", model: "m" })),
    saveAudio: vi.fn(async () => "j1/1.mp3"),
    ...over,
  };
  return { deps, row: () => row };
}
const call = (id: string): AgentEvent => ({ id, type: "agent.custom_tool_use", name: "generate_music", input: { style_prompt: "s", lyrics: "l", duration_class: "clip" } });

describe("double tick", () => {
  it("two concurrent first ticks create exactly one session", async () => {
    let claimed = false;
    const h = harness([]);
    h.deps.store.get = vi.fn(async () => null);
    h.deps.store.claimStart = vi.fn(async () => (claimed ? false : (claimed = true)));
    const r = await Promise.all([advance("j1", h.deps), advance("j1", h.deps)]);
    expect(r.sort()).toEqual(["started", "waiting"]);
    expect(h.deps.sessions.create).toHaveBeenCalledTimes(1);
  });
  it("two ticks racing one pending render never pay for a second", async () => {
    const h = harness([call("e1")]);
    await Promise.all([advance("j1", h.deps), advance("j1", h.deps)]);
    expect(h.deps.music).toHaveBeenCalledTimes(1);
  });
});

// ---- Lyria provider chaos ----
function guard() {
  const g = { reserved: 0, released: 0 };
  const sg: SpendGuard = { reserve: async (a) => { g.reserved += a; return true; }, release: async (a) => { g.released += a; } };
  return { g, sg };
}
const okBody = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/mpeg", data: "AAAA" } }] } }] }), { status: 200 });

describe("lyria chaos", () => {
  it.each([429, 500, 503])("retries a %i then succeeds without releasing spend", async (status) => {
    const { g, sg } = guard();
    const f = vi.fn().mockResolvedValueOnce(new Response("busy", { status })).mockResolvedValueOnce(okBody());
    const r = await generateMusic({ stylePrompt: "s", lyrics: "l", durationClass: "clip" }, { guard: sg, apiKey: "k", fetchImpl: f as never, retryDelayMs: 0 });
    expect(r.audio.byteLength).toBeGreaterThan(0);
    expect(g.released).toBe(0);
  });
  it.each([429, 503])("gives back the whole reservation when %i never clears", async (status) => {
    const { g, sg } = guard();
    const f = vi.fn(async () => new Response("busy", { status }));
    await expect(generateMusic({ stylePrompt: "s", lyrics: "l", durationClass: "full" }, { guard: sg, apiKey: "k", fetchImpl: f as never, retryDelayMs: 0 })).rejects.toThrow(String(status));
    expect(f).toHaveBeenCalledTimes(3);
    expect(g.released).toBe(g.reserved);
  });
  it("does not retry a 400 and still releases", async () => {
    const { g, sg } = guard();
    const f = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(generateMusic({ stylePrompt: "s", lyrics: "l", durationClass: "clip" }, { guard: sg, apiKey: "k", fetchImpl: f as never, retryDelayMs: 0 })).rejects.toThrow("400");
    expect(f).toHaveBeenCalledTimes(1);
    expect(g.released).toBe(g.reserved);
  });
  it("a network drop (fetch throws) releases the reservation", async () => {
    const { g, sg } = guard();
    const f = vi.fn(async () => { throw new Error("fetch failed"); });
    await expect(generateMusic({ stylePrompt: "s", lyrics: "l", durationClass: "clip" }, { guard: sg, apiKey: "k", fetchImpl: f as never, retryDelayMs: 0 })).rejects.toThrow("fetch failed");
    expect(g.released).toBe(g.reserved);
  });
});

describe("storage chaos", () => {
  it("a failed audio upload becomes a retry-free error result and records render_error, not a crash", async () => {
    const h = harness([call("e1")], { saveAudio: vi.fn(async () => { throw new Error("storage 503"); }) });
    expect(await advance("j1", h.deps)).toBe("waiting");
    expect(h.deps.sessions.sendToolResult).toHaveBeenCalledWith("s1", "e1", "Render failed; do not retry.", true);
    expect(h.row()?.audio_path).toBeNull();
    expect(h.deps.store.upsert).toHaveBeenCalledWith(expect.objectContaining({ render_error: "storage 503" }));
  });
});

// ---- sweeper ----
const NOW = Date.parse("2026-10-12T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
function sweepHarness(jobs: StuckCandidate[], runs: Record<string, SweepRun | null>, failResult = true) {
  const d = {
    listProcessing: vi.fn(async () => jobs),
    getRun: vi.fn(async (id: string) => runs[id] ?? null),
    failJob: vi.fn(async () => failResult),
    markRunFailed: vi.fn(async () => {}),
    releaseSpend: vi.fn(async () => {}),
    now: () => NOW,
  } satisfies SweepDeps;
  return d;
}
const job = (over: Partial<StuckCandidate> = {}): StuckCandidate => ({ id: "j1", user_id: "u1", started_at: ago(MIN_AGE_MS + 1000), agent_lease_until: null, target_seconds: 30, ...over });

describe("stuck-job sweeper", () => {
  it("fails a job that is old and shows no progress, and releases a leaked reservation", async () => {
    const d = sweepHarness([job()], { j1: { audio_path: null, lyria_calls: 1, render_error: null, updated_at: ago(NO_PROGRESS_MS + 1000) } });
    expect(await sweepStuckJobs(d)).toEqual({ j1: "failed" });
    expect(d.failJob).toHaveBeenCalledWith("j1", STUCK_CODE);
    expect(d.releaseSpend).toHaveBeenCalledWith("u1", 0.05);
    expect(d.markRunFailed).toHaveBeenCalledWith("j1");
  });
  it("releases one estimate per taken render slot, from the stored run", async () => {
    const d = sweepHarness([job()], { j1: { audio_path: null, lyria_calls: 2, render_error: null, updated_at: ago(NO_PROGRESS_MS + 1000) } });
    await sweepStuckJobs(d);
    expect(d.releaseSpend).toHaveBeenCalledWith("u1", 0.1);
  });
  it("a 40-minute-old job whose run was updated 2 minutes ago is NOT failed", async () => {
    const d = sweepHarness([job({ started_at: ago(40 * 60_000) })], { j1: { audio_path: null, lyria_calls: 1, render_error: null, updated_at: ago(2 * 60_000) } });
    expect(await sweepStuckJobs(d)).toEqual({ j1: "skipped_progressing" });
    expect(d.failJob).not.toHaveBeenCalled();
    expect(d.releaseSpend).not.toHaveBeenCalled();
  });
  it("age alone never fails a job: a 50-minute-old Pro job with a fresh run survives", async () => {
    const d = sweepHarness([job({ started_at: ago(50 * 60_000) })], { j1: { audio_path: null, lyria_calls: 0, render_error: null, updated_at: ago(19 * 60_000) } });
    expect(await sweepStuckJobs(d)).toEqual({ j1: "skipped_progressing" });
  });
  it("a job with no run row is failed only once it is old and past the no-progress window", async () => {
    const d = sweepHarness([job({ id: "a", started_at: ago(35 * 60_000) }), job({ id: "b", started_at: ago(10 * 60_000) })], {});
    expect(await sweepStuckJobs(d)).toEqual({ a: "failed", b: "skipped_young" });
  });
  it("uses the full-length estimate for long songs", async () => {
    const d = sweepHarness([job({ target_seconds: 120 })], { j1: { audio_path: null, lyria_calls: 1, render_error: null, updated_at: ago(NO_PROGRESS_MS + 1000) } });
    await sweepStuckJobs(d);
    expect(d.releaseSpend).toHaveBeenCalledWith("u1", 0.25);
  });
  it("releases nothing when no render slot was ever taken", async () => {
    const d = sweepHarness([job()], { j1: { audio_path: null, lyria_calls: 0, render_error: null, updated_at: ago(NO_PROGRESS_MS + 1000) } });
    await sweepStuckJobs(d);
    expect(d.releaseSpend).not.toHaveBeenCalled();
  });
  it("does not double-release when generateMusic already released (render_error set)", async () => {
    const d = sweepHarness([job()], { j1: { audio_path: null, lyria_calls: 1, render_error: "lyria 503", updated_at: ago(NO_PROGRESS_MS + 1000) } });
    await sweepStuckJobs(d);
    expect(d.failJob).toHaveBeenCalled();
    expect(d.releaseSpend).not.toHaveBeenCalled();
  });
  it("leaves young jobs, live leases and jobs that already have audio alone", async () => {
    const d = sweepHarness(
      [job({ id: "young", started_at: ago(60_000) }), job({ id: "leased", agent_lease_until: new Date(NOW + 5000).toISOString() }), job({ id: "audio" })],
      { audio: { audio_path: "audio/1.mp3", lyria_calls: 1, render_error: null, updated_at: ago(NO_PROGRESS_MS + 1000) }, leased: null },
    );
    expect(await sweepStuckJobs(d)).toEqual({ young: "skipped_young", leased: "skipped_leased", audio: "skipped_has_audio" });
    expect(d.failJob).not.toHaveBeenCalled();
    expect(d.releaseSpend).not.toHaveBeenCalled();
  });
  it("sweeps once: a second sweeper that loses the race neither fails nor releases", async () => {
    const d = sweepHarness([job()], { j1: { audio_path: null, lyria_calls: 1, render_error: null, updated_at: ago(NO_PROGRESS_MS + 1000) } }, false);
    expect(await sweepStuckJobs(d)).toEqual({ j1: "skipped_raced" });
    expect(d.releaseSpend).not.toHaveBeenCalled();
  });
  it("a failing run-row update does not block the spend release", async () => {
    const d = sweepHarness([job()], { j1: { audio_path: null, lyria_calls: 1, render_error: null, updated_at: ago(NO_PROGRESS_MS + 1000) } });
    d.markRunFailed.mockRejectedValueOnce(new Error("db"));
    await sweepStuckJobs(d);
    expect(d.releaseSpend).toHaveBeenCalledOnce();
  });
  it("shows users a friendly message for the timeout code", () => {
    expect(friendlyJobError(STUCK_CODE)).toMatch(/took too long/);
  });
});
