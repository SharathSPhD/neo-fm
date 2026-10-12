import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/agent/adapters", () => ({ serviceClient: () => { throw new Error("db must not be reached when unauthorized"); } }));
beforeEach(() => { process.env.CRON_SECRET = "s3cret"; delete process.env.AGENT_TICK_SECRET; });

const mk = (h?: string) => ({ headers: new Headers(h ? { authorization: h } : {}), nextUrl: new URL("http://x/api/admin/x") }) as never;

describe("snapshot and trend routes", () => {
  it("require the bearer secret", async () => {
    const snap = await import("../../../app/api/admin/health-snapshot/route");
    const trends = await import("../../../app/api/admin/health-trends/route");
    for (const GET of [snap.GET, trends.GET]) {
      expect((await GET(mk())).status).toBe(401);
      expect((await GET(mk("Bearer nope"))).status).toBe(401);
    }
  });
});
