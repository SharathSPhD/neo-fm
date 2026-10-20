import { describe, expect, it } from "vitest";

import { buildPullFunnel } from "../lib/ops/pull-funnel";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const counters = { visits: 200, anonStationPlays: 50 };

describe("buildPullFunnel", () => {
  it("counts day-1 and day-7 returns only for cohort members whose day has passed", () => {
    const cohort = [
      { id: "a", created_at: "2026-10-10T08:00:00Z" }, // d1 + d7 elapsed
      { id: "b", created_at: "2026-10-18T08:00:00Z" }, // d1 elapsed, d7 not
      { id: "c", created_at: "2026-10-20T01:00:00Z" }, // nothing elapsed
    ];
    const activity = [
      { user_id: "a", created_at: "2026-10-10T09:00:00Z" },
      { user_id: "a", created_at: "2026-10-11T20:00:00Z" },
      { user_id: "a", created_at: "2026-10-17T07:00:00Z" },
      { user_id: "b", created_at: "2026-10-18T09:00:00Z" },
      { user_id: "c", created_at: "2026-10-20T02:00:00Z" },
    ];
    const f = buildPullFunnel(cohort, activity, counters, 14, NOW);
    expect(f.signups).toBe(3);
    expect(f.activated).toBe(3);
    expect(f.returned_d1).toEqual({ eligible: 2, returned: 1, rate: 0.5 });
    expect(f.returned_d7).toEqual({ eligible: 1, returned: 1, rate: 1 });
    expect(f.rates.visit_to_signup).toBe(0.015);
    expect(f.rates.visit_to_anon_play).toBe(0.25);
  });
  it("ignores activity from users outside the cohort and handles an empty cohort", () => {
    const f = buildPullFunnel([], [{ user_id: "x", created_at: "2026-10-19T00:00:00Z" }], counters, 7, NOW);
    expect(f.signups).toBe(0);
    expect(f.activated).toBe(0);
    expect(f.returned_d1.rate).toBeNull();
    expect(f.rates.signup_to_activated).toBeNull();
  });
  it("a signup with no activity is not activated", () => {
    const f = buildPullFunnel([{ id: "a", created_at: "2026-10-15T00:00:00Z" }], [], counters, 7, NOW);
    expect(f.activated).toBe(0);
    expect(f.returned_d1).toEqual({ eligible: 1, returned: 0, rate: 0 });
  });
});
