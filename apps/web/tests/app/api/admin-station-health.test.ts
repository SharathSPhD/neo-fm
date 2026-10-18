import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signals = vi.fn();
const errors = vi.fn();
vi.mock("../../../lib/agent/adapters", () => ({
  serviceClient: () => ({
    from: (t: string) =>
      t === "station_signals"
        ? { select: () => ({ gte: () => ({ limit: () => signals() }) }) }
        : { select: () => ({ or: () => ({ gte: () => ({ limit: () => errors() }) }) }) },
  }),
}));

import { GET } from "../../../app/api/admin/station-health/route";

const get = (auth?: string) =>
  new NextRequest("http://localhost/api/admin/station-health?hours=6", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret-value";
  signals.mockReset();
  errors.mockReset();
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/admin/station-health", () => {
  it("requires the bearer secret", async () => {
    expect((await GET(get())).status).toBe(401);
    expect(signals).not.toHaveBeenCalled();
  });

  it("returns the summary", async () => {
    signals.mockResolvedValue({ data: [{ user_id: "a", kind: "play" }, { user_id: "a", kind: "skip" }], error: null });
    errors.mockResolvedValue({ data: [], error: null });
    const res = await GET(get("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ window_hours: 6, listeners: 1, plays: 1, skip_rate: 1 });
  });

  it("502s when a query fails", async () => {
    signals.mockResolvedValue({ data: null, error: { message: "boom" } });
    errors.mockResolvedValue({ data: [], error: null });
    expect((await GET(get("Bearer s3cret-value"))).status).toBe(502);
  });
});
