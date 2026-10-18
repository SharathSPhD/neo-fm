import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/agent/adapters", () => ({ serviceClient: () => { throw new Error("db must not be reached when unauthorized"); } }));

beforeEach(() => { process.env.CRON_SECRET = "s3cret"; delete process.env.AGENT_TICK_SECRET; });

describe("GET /api/admin/health-summary", () => {
  it("rejects missing and wrong bearer", async () => {
    const { GET } = await import("../../../app/api/admin/health-summary/route");
    const mk = (h?: string) => ({ headers: new Headers(h ? { authorization: h } : {}), nextUrl: new URL("http://x/api/admin/health-summary") }) as never;
    expect((await GET(mk())).status).toBe(401);
    expect((await GET(mk("Bearer nope"))).status).toBe(401);
  });
});
