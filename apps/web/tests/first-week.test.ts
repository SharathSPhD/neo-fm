import { describe, expect, it } from "vitest";

import { costPerListenerHour, summarizeFirstWeek, type SignalRow } from "../lib/ops/first-week";

const row = (user_id: string, kind: string, day: string, position_ms: number | null = null): SignalRow => ({ user_id, kind, position_ms, created_at: `${day}T10:00:00Z` });

describe("summarizeFirstWeek", () => {
  it("splits by UTC day and computes rates and listened minutes", () => {
    const w = summarizeFirstWeek([
      row("a", "play", "2026-11-05"), row("a", "finish", "2026-11-05", 60_000),
      row("b", "play", "2026-11-05"), row("b", "skip", "2026-11-05", 30_000),
      row("a", "play", "2026-11-06"), row("a", "like", "2026-11-06"),
    ], 7);
    expect(Object.keys(w.by_day)).toEqual(["2026-11-05", "2026-11-06"]);
    expect(w.by_day["2026-11-05"]).toMatchObject({ listeners: 2, plays: 2, skip_rate: 0.5, finish_rate: 0.5, listened_minutes: 1.5 });
    expect(w.totals).toMatchObject({ listeners: 2, plays: 3, likes: 1 });
    expect(w.returning_listeners).toBe(1);
  });

  it("is empty-safe", () => {
    expect(summarizeFirstWeek([], 7)).toMatchObject({ by_day: {}, returning_listeners: 0, totals: { plays: 0, skip_rate: null, listened_minutes: 0 } });
  });
});

describe("costPerListenerHour", () => {
  it("divides spend by hours and returns null with no listening", () => {
    expect(costPerListenerHour(120, 4, 10, 0.25)).toMatchObject({ listener_hours: 2, ledger_gbp_per_listener_hour: 2, pool_estimate_gbp: 2.5, pool_estimate_gbp_per_listener_hour: 1.25 });
    expect(costPerListenerHour(0, 4, 10, 0.25).ledger_gbp_per_listener_hour).toBeNull();
  });
});
