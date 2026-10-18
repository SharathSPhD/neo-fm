import { describe, expect, it } from "vitest";

import { analyseSpend } from "../lib/spend/monitor";
import { matchesTestUser } from "../scripts/cleanup-test-users.mjs";

const t = { clipCostGbp: 0.05, fullCostGbp: 0.25, globalCapGbp: 3, staleRunMinutes: 30, warnFraction: 0.8 };
const now = new Date("2026-10-13T08:00:00Z");

describe("analyseSpend", () => {
  it("is quiet when reservations match renders", () => {
    const r = analyseSpend("2026-10-01", [{ user_id: "a", reserved_gbp: 0.5 }], [{ job_id: "j", user_id: "a", status: "done", lyria_calls: 2, updated_at: now.toISOString() }], t, now);
    expect(r.alerts).toEqual([]);
    expect(r.leaks).toEqual([]);
  });
  it("flags reservations no call can explain, with min/max bounds", () => {
    const r = analyseSpend("2026-10-01", [{ user_id: "a", reserved_gbp: 1 }], [{ job_id: "j", user_id: "a", status: "failed", lyria_calls: 1, updated_at: now.toISOString() }], t, now);
    expect(r.leaks).toMatchObject([{ user_id: "a", leaked_gbp_min: 0.75, leaked_gbp_max: 0.95 }]);
  });
  it("flags runs stuck running and budget thresholds", () => {
    const old = new Date(now.getTime() - 90 * 60_000).toISOString();
    const r = analyseSpend("2026-10-01", [{ user_id: "a", reserved_gbp: 2.5 }], [{ job_id: "j", user_id: "a", status: "running", lyria_calls: 10, updated_at: old }], t, now);
    expect(r.staleRuns).toMatchObject([{ job_id: "j", age_minutes: 90 }]);
    expect(r.globalUsedFraction).toBeCloseTo(0.8333, 3);
    expect(r.alerts.length).toBe(2);
  });
});

describe("cleanup matcher", () => {
  it("matches only the intended test accounts", () => {
    for (const e of ["e2e-bot@x.com", "E2E-BOT+1@example.org", "showcase-a@neo.fm", "showcase-b@neo.fm", "delivered@resend.dev"]) expect(matchesTestUser(e)).toBe(true);
    for (const e of ["real@gmail.com", "showcase-c@neo.fm", "my-e2e-bot@x.com", "delivered@resend.dev.evil.com", null]) expect(matchesTestUser(e)).toBe(false);
  });
});
