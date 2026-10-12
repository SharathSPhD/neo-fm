import { describe, expect, it } from "vitest";

import type { FunnelSummary } from "../lib/ops/funnel";
import { summarize } from "../lib/ops/health-summary";
import { buildTrend, stripForStorage } from "../lib/ops/snapshot";

const now = new Date("2026-10-12T12:00:00Z");
const iso = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const job = (status: string, c: number, f?: number) => ({ status, error: status === "failed" ? "render_failed" : null, created_at: iso(c), started_at: null, finished_at: f === undefined ? null : iso(f) });
const spend = { global: [{ provider: "lyria", reserved_gbp: 1.2, cap_gbp: 3 }], topUsersThisMonth: [{ user_id: "u1", reserved_gbp: 0.5 }] };
const funnel = { signups: 4, views: { landing_view: 90, pricing_view: 0, signup_view: 9, share_view: 0 } } as FunnelSummary;

describe("health snapshots", () => {
  it("drops user ids before storage", () => {
    const s = summarize([], [], spend, now);
    expect(stripForStorage(s).spend.top_users_this_month).toEqual([]);
    expect(s.spend.top_users_this_month).toHaveLength(1);
  });

  it("turns rows into points sorted oldest first", () => {
    const a = summarize([job("completed", 20, 10), job("failed", 15, 14), job("completed", 30, 0), job("completed", 5, 1)], [], spend, now);
    const b = summarize([], [], { global: [], topUsersThisMonth: [] }, now);
    const pts = buildTrend([
      { day: "2026-10-12", summary: a, funnel },
      { day: "2026-10-11", summary: b, funnel: null },
    ]);
    expect(pts.map((p) => p.day)).toEqual(["2026-10-11", "2026-10-12"]);
    expect(pts[1]).toMatchObject({ jobs: 4, failure_rate: 0.25, lyria_reserved_gbp: 1.2, signups: 4, landing_views: 90 });
    expect(pts[0]).toMatchObject({ jobs: 0, failure_rate: null, lyria_reserved_gbp: null, signups: null });
  });
});
