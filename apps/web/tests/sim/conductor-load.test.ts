import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT, DEFAULT_LATENCY, simulate, stats, type Latency, type Policy, type SimResult, type Tier } from "./conductor-sim";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T12:00:00Z")); });
afterEach(() => vi.useRealTimers());

const burst = (n: number, tier: Tier = "pro") => Array.from({ length: n }, () => ({ atS: 5, tier }));
const f = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "n/a");
const row = (name: string, r: SimResult, tier?: Tier) => { const s = stats(r, tier); return `${name.padEnd(34)} n=${s.n} failed=${s.failed} p50=${f(s.p50)}m p95=${f(s.p95)}m max=${f(s.max)}m killedTicks=${r.killedTicks}`; };

const variants: Policy[] = [
  CURRENT,
  { ...CURRENT, name: "claim-all", maxClaim: 50 },
  { ...CURRENT, name: "claim-all + pool(8)", maxClaim: 50, mode: "pool", concurrency: 8 },
  { ...CURRENT, name: "claim-all + pool(16)", maxClaim: 50, mode: "pool", concurrency: 16 },
];

describe("conductor burst capacity (simulation, no real spend)", () => {
  it("scheduling alone explains only a modest burst slowdown; provider capacity and render time reproduce ~40 min", async () => {
    const quiet = await simulate({ policy: CURRENT, arrivals: burst(1) });
    const lines = [row("quiet x1", quiet)];
    const b10 = await simulate({ policy: CURRENT, arrivals: burst(10) });
    lines.push(row("burst x10, unconstrained provider", b10));
    const sweep: [string, Partial<Latency>][] = [
      ["burst x10, provider slots=4", { agentSlots: 4 }],
      ["burst x10, provider slots=2", { agentSlots: 2 }],
      ["burst x10, render 150s", { renderS: { free: 25, creator: 150, pro: 150 } }],
      ["burst x10, render 200s", { renderS: { free: 25, creator: 200, pro: 200 } }],
    ];
    for (const [name, over] of sweep) lines.push(row(name, await simulate({ policy: CURRENT, arrivals: burst(10), latency: { ...DEFAULT_LATENCY, ...over } })));
    console.log("\n" + lines.join("\n"));
    expect(stats(quiet).p50).toBeGreaterThan(5);
    expect(stats(quiet).p50).toBeLessThan(11);
    // Tick scheduling alone (unconstrained provider) adds minutes, not tens of minutes.
    expect(stats(b10).max).toBeLessThan(stats(quiet).p50 + 10);
  });

  it("compares fixes on a burst of 10 Pro jobs", async () => {
    const lines: string[] = [];
    const res: Record<string, SimResult> = {};
    for (const p of variants) { res[p.name] = await simulate({ policy: p, arrivals: burst(10) }); lines.push(row(p.name, res[p.name]!)); }
    console.log("\n" + lines.join("\n"));
    expect(stats(res["claim-all + pool(8)"]!).max).toBeLessThanOrEqual(stats(res["current"]!).max);
    expect(stats(res["claim-all + pool(8)"]!).failed).toBe(0);
  });

  it("shows tier fairness under a mixed burst (5 pro + 15 free)", async () => {
    const mix = [...burst(5, "pro"), ...burst(15, "free")];
    const out: string[] = [];
    for (const p of [CURRENT, { ...CURRENT, name: "pool(8) fifo", maxClaim: 50, mode: "pool" as const, concurrency: 8 }, { ...CURRENT, name: "pool(8) weighted-aging", maxClaim: 50, mode: "pool" as const, concurrency: 8, order: "weighted-aging" as const }]) {
      const r = await simulate({ policy: p, arrivals: mix });
      out.push(row(p.name + " [pro]", r, "pro"), row(p.name + " [free]", r, "free"));
    }
    console.log("\n" + out.join("\n"));
  });

  it("slow renders make a killed tick lose the render and the retry is refused (job fails without audio)", async () => {
    const slow = { ...DEFAULT_LATENCY, renderS: { free: 25, creator: 150, pro: 150 } };
    const cur = await simulate({ policy: CURRENT, arrivals: burst(10), latency: slow });
    const pool = await simulate({ policy: { ...CURRENT, name: "pool(8)", maxClaim: 50, mode: "pool", concurrency: 8 }, arrivals: burst(10), latency: slow });
    console.log("\n" + row("slow render, current", cur) + "\n" + row("slow render, pool(8)", pool));
    expect(stats(cur).failed).toBeGreaterThan(0);
    expect(stats(pool).failed).toBe(0);
  });

  it("fairness when the provider is the constraint (slots=4, 5 pro + 15 free)", async () => {
    const mix = [...burst(15, "free"), ...burst(5, "pro")]; // free arrived first
    const lat = { ...DEFAULT_LATENCY, agentSlots: 4 };
    const out: string[] = [];
    for (const order of ["fifo", "weighted-aging"] as const) {
      const r = await simulate({ policy: { ...CURRENT, name: `pool(8) ${order}`, maxClaim: 50, mode: "pool", concurrency: 8, order }, arrivals: mix, latency: lat });
      out.push(row(`pool(8) ${order} [pro]`, r, "pro"), row(`pool(8) ${order} [free]`, r, "free"));
    }
    console.log("\n" + out.join("\n"));
  });
});
