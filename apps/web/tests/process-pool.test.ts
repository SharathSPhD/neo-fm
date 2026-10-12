import { describe, expect, it } from "vitest";
import { prioritise, runPool } from "../lib/agent/process";

describe("prioritise", () => {
  const now = Date.parse("2026-01-01T01:00:00Z");
  const w = (j: { tier: string }) => ({ pro: 3, creator: 2, free: 1 }[j.tier] ?? 1);
  it("puts paying tiers first at equal age", () => {
    const t = new Date(now - 60_000).toISOString();
    const out = prioritise([{ tier: "free", started_at: t }, { tier: "pro", started_at: t }, { tier: "creator", started_at: t }], w, now);
    expect(out.map((j) => j.tier)).toEqual(["pro", "creator", "free"]);
  });
  it("lets an old free job overtake a fresh pro job (no starvation)", () => {
    const out = prioritise([{ tier: "pro", started_at: new Date(now - 60_000).toISOString() }, { tier: "free", started_at: new Date(now - 30 * 60_000).toISOString() }], w, now);
    expect(out[0]!.tier).toBe("free");
  });
});

describe("runPool", () => {
  it("never exceeds the pool size and starts the next job as soon as a slot frees", async () => {
    let inflight = 0, peak = 0;
    const started: number[] = [];
    await runPool([40, 1, 1, 1, 1], 2, async (ms) => {
      started.push(ms); inflight++; peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, ms)); inflight--;
    });
    expect(peak).toBe(2);
    expect(started).toHaveLength(5);
  });
});
