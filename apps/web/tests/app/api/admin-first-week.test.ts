import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signals = vi.fn();
vi.mock("../../../lib/agent/adapters", () => ({
  serviceClient: () => ({
    from: (t: string) => {
      if (t === "station_signals") return { select: () => ({ gte: () => ({ order: () => ({ limit: () => signals() }) }) }) };
      if (t === "user_spend") return { select: () => Promise.resolve({ data: [{ reserved_gbp: "2" }], error: null }) };
      return { select: () => ({ eq: () => Promise.resolve({ count: 4, error: null }) }) };
    },
  }),
}));
vi.mock("../../../lib/ops/load", () => ({
  OpsQueryError: class extends Error {},
  loadFunnel: async () => ({ window_days: 7 }),
  loadPullFunnel: async () => ({ window_days: 7, signups: 0 }),
}));

import { GET } from "../../../app/api/admin/first-week/route";

const get = (auth?: string) => new NextRequest("http://localhost/api/admin/first-week", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => { process.env.CRON_SECRET = "s3cret-value"; signals.mockReset(); });
afterEach(() => { delete process.env.CRON_SECRET; });

describe("GET /api/admin/first-week", () => {
  it("requires the bearer secret", async () => {
    expect((await GET(get())).status).toBe(401);
    expect(signals).not.toHaveBeenCalled();
  });

  it("returns aggregates without user ids", async () => {
    signals.mockResolvedValue({ data: [
      { user_id: "u-1", kind: "play", position_ms: null, created_at: "2026-11-05T10:00:00Z" },
      { user_id: "u-1", kind: "finish", position_ms: 3_600_000, created_at: "2026-11-05T10:01:00Z" },
    ], error: null });
    const res = await GET(get("Bearer s3cret-value"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.cost).toMatchObject({ listener_hours: 1, ledger_gbp_per_listener_hour: 2, admitted_pool_tracks: 4 });
    expect(body.funnel).toEqual({ window_days: 7 });
    expect(body.pull).toEqual({ window_days: 7, signups: 0 });
    expect(JSON.stringify(body)).not.toContain("u-1");
  });
});
