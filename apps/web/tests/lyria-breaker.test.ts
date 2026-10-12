import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker, isOutage } from "../lib/agent/circuit-breaker";
import { generateMusic, type SpendGuard } from "../lib/agent/lyria";
import { advance, type AdvanceDeps, type AgentEvent, type RunRow } from "../lib/agent/runner";

function clock() { let t = 1_000_000; return { now: () => t, tick: (ms: number) => void (t += ms) }; }

describe("circuit breaker", () => {
  it("opens after the threshold of outage failures and fails fast", () => {
    const c = clock(); const b = new CircuitBreaker({ threshold: 3, cooldownMs: 60_000, now: c.now });
    b.onFailure(true); b.onFailure(true);
    expect(b.acquire().ok).toBe(true);
    b.onFailure(true);
    expect(b.state).toBe("open");
    const g = b.acquire();
    expect(g.ok).toBe(false);
  });
  it("does not trip on client errors, and a success resets the streak", () => {
    const b = new CircuitBreaker({ threshold: 2 });
    b.onFailure(false); b.onFailure(false); b.onFailure(false);
    expect(b.state).toBe("closed");
    b.onFailure(true); b.onSuccess(); b.onFailure(true);
    expect(b.state).toBe("closed");
  });
  it("admits exactly one probe after the cooldown, closes on success", () => {
    const c = clock(); const b = new CircuitBreaker({ threshold: 1, cooldownMs: 1000, now: c.now });
    b.onFailure(true);
    c.tick(1000);
    expect(b.state).toBe("half-open");
    expect(b.acquire().ok).toBe(true);
    expect(b.acquire().ok).toBe(false);
    b.onSuccess();
    expect(b.state).toBe("closed");
    expect(b.acquire().ok).toBe(true);
  });
  it("a failed probe re-opens with a doubled cooldown, capped", () => {
    const c = clock(); const b = new CircuitBreaker({ threshold: 1, cooldownMs: 1000, maxCooldownMs: 3000, now: c.now });
    b.onFailure(true);
    for (const expected of [2000, 3000, 3000]) {
      c.tick(1_000_000); // well past any cooldown
      expect(b.acquire().ok).toBe(true);
      b.onFailure(true);
      expect(b.state).toBe("open");
      c.tick(expected - 1);
      expect(b.state).toBe("open");
      c.tick(1);
      expect(b.state).toBe("half-open");
      b.acquire(); // take the probe slot so the loop's next iteration starts from a clean failure
      b.onFailure(true);
    }
  });
  it("recovers a stuck probe once the cooldown passes again", () => {
    const c = clock(); const b = new CircuitBreaker({ threshold: 1, cooldownMs: 1000, now: c.now });
    b.onFailure(true); c.tick(1000);
    expect(b.acquire().ok).toBe(true); // probe taken, never reports back
    c.tick(1000);
    expect(b.acquire().ok).toBe(true);
  });
  it("classifies errors", () => {
    expect(isOutage(new Error("lyria 429: slow down"))).toBe(true);
    expect(isOutage(new Error("lyria 503: x"))).toBe(true);
    expect(isOutage(new Error("lyria 400: bad"))).toBe(false);
    expect(isOutage(new Error("lyria returned no audio part"))).toBe(false);
    expect(isOutage(new Error("fetch failed"))).toBe(true);
  });
});

describe("probe release", () => {
  it("release() frees a held half-open probe so the next caller is admitted without waiting a cooldown", () => {
    const c = clock(); const b = new CircuitBreaker({ threshold: 1, cooldownMs: 1000, now: c.now });
    b.onFailure(true);
    c.tick(1000);
    expect(b.acquire()).toEqual({ ok: true });
    expect(b.acquire().ok).toBe(false);
    b.release();
    expect(b.acquire()).toEqual({ ok: true });
  });
});

describe("generateMusic + breaker", () => {
  const guard: SpendGuard = { reserve: async () => true, release: async () => {} };
  const run = (status: number, breaker: CircuitBreaker) =>
    generateMusic({ stylePrompt: "s", lyrics: "l", durationClass: "clip" }, { guard, breaker, apiKey: "k", retryDelayMs: 0, fetchImpl: (async () => new Response("x", { status })) as never });
  it("three persistent 503s open the breaker; a 400 never does", async () => {
    const b = new CircuitBreaker({ threshold: 3 });
    for (let i = 0; i < 2; i++) await expect(run(400, b)).rejects.toThrow();
    expect(b.state).toBe("closed");
    for (let i = 0; i < 3; i++) await expect(run(503, b)).rejects.toThrow();
    expect(b.state).toBe("open");
  });
  it("a render that returns audio closes a half-open breaker", async () => {
    const c = clock(); const b = new CircuitBreaker({ threshold: 1, cooldownMs: 10, now: c.now });
    await expect(run(429, b)).rejects.toThrow();
    c.tick(10);
    b.acquire();
    const ok = JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/mpeg", data: "AAAA" } }] } }] });
    await generateMusic({ stylePrompt: "s", lyrics: "l", durationClass: "clip" }, { guard, breaker: b, apiKey: "k", fetchImpl: (async () => new Response(ok)) as never });
    expect(b.state).toBe("closed");
  });
});

describe("advance gate", () => {
  const call: AgentEvent = { id: "e1", type: "agent.custom_tool_use", name: "generate_music", input: { style_prompt: "s", lyrics: "l", duration_class: "clip" } };
  function setup(gate: () => string | null) {
    let row: RunRow = { job_id: "j1", session_id: "s1", lyria_calls: 0, audio_path: null, status: "running" };
    const deps: AdvanceDeps = {
      sessions: { create: vi.fn(), sendOutcome: vi.fn(), listEvents: vi.fn(async () => [call]), sendToolResult: vi.fn(async () => {}), sendToolConfirmation: vi.fn(), status: vi.fn(async () => "running") } as never,
      store: { get: async () => row, upsert: async (r) => void (row = { ...row, ...r }), claimStart: async () => true, claimRender: vi.fn(async () => 1) },
      environmentId: "e", agentId: "a", maxLyriaCalls: 1, maxOutcomeIterations: 1,
      brief: { language: "hi", styleFamily: "x", targetSeconds: 30, prompt: "p" },
      music: vi.fn(async () => ({ audio: new Uint8Array(1), mimeType: "audio/mpeg", model: "m" })),
      saveAudio: vi.fn(async () => "j1/1.mp3"),
      gate,
    };
    return deps;
  }
  it("an open breaker defers the render without taking the slot or answering the agent", async () => {
    const d = setup(() => "lyria circuit open");
    expect(await advance("j1", d)).toBe("waiting");
    expect(d.store.claimRender).not.toHaveBeenCalled();
    expect(d.music).not.toHaveBeenCalled();
    expect(d.sessions.sendToolResult).not.toHaveBeenCalled();
  });
  it("hands the half-open probe back when the call exits before reaching the provider", async () => {
    const release = vi.fn();
    const d = setup(() => null);
    d.gateRelease = release;
    d.store.claimRender = vi.fn(async () => null);
    await advance("j1", d);
    expect(release).toHaveBeenCalledTimes(1);
    expect(d.music).not.toHaveBeenCalled();
  });
  it("renders on the next tick once the gate is open again", async () => {
    let blocked = true;
    const d = setup(() => (blocked ? "down" : null));
    await advance("j1", d);
    blocked = false;
    await advance("j1", d);
    expect(d.music).toHaveBeenCalledTimes(1);
  });
});
