import { describe, expect, it } from "vitest";
import { composite, pickWinner, renderBestOf, type Scorer } from "../lib/render/best-of";

type C = { id: number; diction: number | null; quality: number | null };
const diction: Scorer<C> = { name: "diction", weight: 2, score: async (c) => c.diction, vetoAtOrBelow: 20 };
const quality: Scorer<C> = { name: "quality", weight: 1, score: async (c) => c.quality };
const opts = { maxRenders: 3, acceptAt: 85, costPerRender: 0.25, maxSpend: 0.75 };
const seq = (cs: C[]) => async (i: number) => cs[i]!;

describe("composite", () => {
  it("renormalises over scorers that answered, so a missing signal is not a zero", () => {
    expect(composite({ a: 90, b: null }, { a: 2, b: 1 })).toBe(90);
    expect(composite({ a: 90, b: 60 }, { a: 2, b: 1 })).toBe(80);
    expect(composite({ a: null }, { a: 1 })).toBeNull();
  });
});

describe("renderBestOf", () => {
  it("stops after one render when the first is good enough (no extra spend)", async () => {
    const r = await renderBestOf(seq([{ id: 0, diction: 95, quality: 80 }]), [diction, quality], opts);
    expect(r.all).toHaveLength(1);
    expect(r.spend).toBe(0.25);
    expect(r.stoppedBecause).toBe("accepted");
  });
  it("re-renders on a weak first take and keeps the best", async () => {
    const r = await renderBestOf(seq([{ id: 0, diction: 40, quality: 70 }, { id: 1, diction: 80, quality: 60 }, { id: 2, diction: 92, quality: 80 }]), [diction, quality], opts);
    expect(r.winner.candidate.id).toBe(2);
    expect(r.stoppedBecause).toBe("accepted");
  });
  it("keeps the best of the lot at the render cap", async () => {
    const r = await renderBestOf(seq([{ id: 0, diction: 50, quality: 50 }, { id: 1, diction: 70, quality: 50 }, { id: 2, diction: 60, quality: 50 }]), [diction, quality], opts);
    expect(r.winner.candidate.id).toBe(1);
    expect(r.stoppedBecause).toBe("render-cap");
  });
  it("never starts a retry that would exceed the spend ceiling", async () => {
    const r = await renderBestOf(seq([{ id: 0, diction: 50, quality: 50 }, { id: 1, diction: 99, quality: 99 }]), [diction, quality], { ...opts, maxSpend: 0.25 });
    expect(r.all).toHaveLength(1);
    expect(r.stoppedBecause).toBe("budget");
  });
  it("a vetoed candidate loses to any non-vetoed one, even with a higher composite", async () => {
    const hi: Scorer<C> = { ...quality, weight: 10 };
    const r = await renderBestOf(seq([{ id: 0, diction: 10, quality: 100 }, { id: 1, diction: 60, quality: 10 }]), [diction, hi], { ...opts, maxRenders: 2 });
    expect(r.winner.candidate.id).toBe(1);
  });
  it("a scorer that throws drops out instead of failing the song", async () => {
    const boom: Scorer<C> = { name: "boom", weight: 5, score: async () => { throw new Error("down"); } };
    const r = await renderBestOf(seq([{ id: 0, diction: 90, quality: null }]), [diction, boom], opts);
    expect(r.winner.composite).toBe(90);
  });
  it("a failed retry returns the earlier take; a failed first render throws", async () => {
    let n = 0;
    const flaky = async () => { if (n++ === 1) throw new Error("429"); return { id: n, diction: 50, quality: 50 }; };
    const r = await renderBestOf(flaky, [diction], opts);
    expect(r.stoppedBecause).toBe("render-failed");
    expect(r.all).toHaveLength(1);
    await expect(renderBestOf(async () => { throw new Error("x"); }, [diction], opts)).rejects.toThrow("x");
  });
  it("if every candidate is vetoed the best one still ships", () => {
    const w = pickWinner([{ candidate: 1, scores: {}, composite: 10, vetoed: true }, { candidate: 2, scores: {}, composite: 30, vetoed: true }]);
    expect(w.candidate).toBe(2);
  });
});

describe("dictionScorer", () => {
  it("scores the transcript against the lyrics and vetoes a mostly unsung render", async () => {
    const { dictionScorer } = await import("../lib/render/scorers");
    const lyrics = "chal re dost station par\nhaath hilaao muskurao";
    const s = dictionScorer<string>(lyrics, async (t) => t);
    expect(await s.score(lyrics)).toBeGreaterThanOrEqual(95);
    const bad = (await s.score("la la la")) as number;
    expect(bad).toBeLessThanOrEqual(s.vetoAtOrBelow as number);
  });
});
