import { describe, expect, it } from "vitest";

import { alertString, failureCode, percentile, summarize, type JobRow } from "../lib/ops/health-summary";

const now = new Date("2026-10-12T12:00:00Z");
const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString();
const job = (status: string, createdMinAgo: number, doneMinAgo?: number, error: string | null = null): JobRow => ({
  status, error, created_at: iso(createdMinAgo), started_at: null, finished_at: doneMinAgo === undefined ? null : iso(doneMinAgo),
});
const spend = { global: [{ provider: "lyria", reserved_gbp: 1.5 }], topUsersThisMonth: [] };

describe("health summary", () => {
  it("percentile handles empty and small lists", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });

  it("normalises failure text to a short code", () => {
    expect(failureCode("render_failed: Lyria 503 for user abc")).toBe("render_failed");
    expect(failureCode(null)).toBe("unknown");
  });

  it("counts statuses, failure codes, queue age and latency", () => {
    const s = summarize(
      [job("completed", 20, 10), job("completed", 30, 0), job("failed", 15, 14, "render_failed: x"), job("queued", 3), job("queued", 12), job("processing", 5)],
      [], spend, now,
    );
    expect(s.counts).toEqual({ completed: 2, failed: 1, queued: 2, processing: 1 });
    expect(s.failures_by_code).toEqual({ render_failed: 1 });
    expect(s.oldest_queued_age_s).toBe(720);
    expect(s.latency_s).toMatchObject({ n: 2, p50: 600, max: 1800 });
    expect(s.alerts.some((a) => a.includes("queue stuck"))).toBe(true);
  });

  it("averages diction match per language and counts QA errors", () => {
    const s = summarize([], [
      { language: "te", diction_qa: { matchPct: 60 } },
      { language: "te", diction_qa: { matchPct: 80 } },
      { language: "hi", diction_qa: { error: "no audio" } },
    ], spend, now);
    expect(s.diction_by_language.te).toEqual({ n: 2, avg_match_pct: 70, errors: 0 });
    expect(s.diction_by_language.hi).toEqual({ n: 0, avg_match_pct: null, errors: 1 });
  });

  it("counts shadow diction-gate verdicts and songs scored before the gate", () => {
    const s = summarize([], [
      { language: "te", diction_qa: { matchPct: 95, verdict: "pass" } },
      { language: "te", diction_qa: { matchPct: 70, verdict: "review" } },
      { language: "bn", diction_qa: { matchPct: 37, verdict: "rerender" } },
      { language: "hi", diction_qa: { matchPct: 90 } },
      { language: "hi", diction_qa: { error: "no audio" } },
    ], spend, now);
    expect(s.diction_gate).toEqual({ pass: 1, review: 1, rerender: 1, ungated: 1 });
  });

  it("alerts on failure rate only past a minimum sample", () => {
    const few = summarize([job("failed", 5, 4, "x"), job("failed", 5, 4, "x")], [], spend, now);
    expect(few.alerts).toEqual([]);
    const many = summarize([...Array(3).fill(0).map(() => job("failed", 5, 4, "x")), job("completed", 9, 1), job("completed", 9, 1)], [], spend, now);
    expect(many.alerts[0]).toContain("failure rate 60%");
  });

  it("alertString is OK when quiet and ALERT when not", () => {
    const quiet = summarize([job("completed", 5, 1)], [], spend, now);
    expect(alertString(quiet)).toBe("OK neo-fm 24h: 1 done, 0 failed, 0 queued, 0 processing");
    const loud = summarize([job("queued", 30)], [], spend, now);
    expect(alertString(loud)).toMatch(/^ALERT .*queue stuck/);
  });
});

describe("spend alert", () => {
  it("alerts when a provider nears its cap", () => {
    const s = summarize([], [], { global: [{ provider: "lyria", reserved_gbp: 2.6, cap_gbp: 3 }], topUsersThisMonth: [] }, now);
    expect(s.alerts[0]).toContain("lyria spend 87% of cap");
    const ok = summarize([], [], { global: [{ provider: "lyria", reserved_gbp: 1, cap_gbp: 3 }], topUsersThisMonth: [] }, now);
    expect(ok.alerts).toEqual([]);
  });
});
