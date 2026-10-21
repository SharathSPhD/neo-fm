import { describe, expect, it } from "vitest";

import { planTeacher } from "../lib/eval/teacher";

const job = (id: string, n = 4) => ({ id, prompt: "Write original song lyrics in Kannada. Output only the lyrics.", n });

describe("planTeacher", () => {
  it("accepts a bounded batch and estimates from list prices", () => {
    const r = planTeacher({ model: "claude-sonnet-5-5", max_usd: 3, jobs: [job("a"), job("b")] });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.plan.calls).toBe(8); expect(r.plan.estimateUsd).toBeGreaterThan(0.03); expect(r.plan.estimateUsd).toBeLessThan(0.07); }
  });
  it("refuses unknown models, empty jobs and oversized batches", () => {
    expect(planTeacher({ model: "gpt-4", jobs: [job("a")] }).ok).toBe(false);
    expect(planTeacher({ model: "claude-haiku-5-5", jobs: [] }).ok).toBe(false);
    expect(planTeacher({ model: "claude-haiku-5-5", jobs: Array.from({ length: 61 }, (_, i) => job(`j${i}`, 1)) }).ok).toBe(false);
    expect(planTeacher({ model: "claude-haiku-5-5", jobs: Array.from({ length: 30 }, (_, i) => job(`j${i}`, 6)) }).ok).toBe(false);
  });
  it("refuses when the estimate exceeds max_usd and caps max_usd at 6", () => {
    const big = Array.from({ length: 40 }, (_, i) => job(`j${i}`, 4));
    const r = planTeacher({ model: "claude-sonnet-5-5", max_usd: 0.5, jobs: big });
    expect(r.ok).toBe(false);
    const hi = planTeacher({ model: "claude-sonnet-5-5", max_usd: 99, jobs: [job("a")] });
    expect(hi.ok && hi.plan.maxUsd).toBe(6);
  });
  it("caps max_tokens at 800 and rejects bad job fields", () => {
    const r = planTeacher({ model: "claude-haiku-5-5", max_tokens: 9999, jobs: [job("a", 1)] });
    expect(r.ok && r.plan.maxTokens).toBe(800);
    expect(planTeacher({ model: "claude-haiku-5-5", jobs: [{ id: "", prompt: "x", n: 1 }] }).ok).toBe(false);
    expect(planTeacher({ model: "claude-haiku-5-5", jobs: [{ id: "a", prompt: "x", n: 9 }] }).ok).toBe(false);
  });
});
