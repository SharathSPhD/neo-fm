import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const result = vi.fn();
vi.mock("../../../lib/agent/adapters", () => ({
  serviceClient: () => ({
    from: () => ({ select: () => ({ gte: () => ({ order: () => ({ limit: () => result() }) }) }) }),
  }),
}));

import { GET } from "../../../app/api/admin/client-errors/route";

const get = (auth?: string) =>
  new NextRequest("http://localhost/api/admin/client-errors?hours=6", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret-value";
  result.mockReset();
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/admin/client-errors", () => {
  it("requires the bearer secret", async () => {
    expect((await GET(get())).status).toBe(401);
    expect((await GET(get("Bearer wrong"))).status).toBe(401);
    expect(result).not.toHaveBeenCalled();
  });

  it("returns grouped errors", async () => {
    result.mockResolvedValue({
      data: [
        { created_at: "2026-01-01T10:00:00Z", fingerprint: "a", name: "E", message: "m", route: "/", boundary: "app", lang: null, ua_family: "chrome", request_id: null },
        { created_at: "2026-01-01T11:00:00Z", fingerprint: "a", name: "E", message: "m", route: "/", boundary: "root", lang: null, ua_family: "chrome", request_id: "r" },
      ],
      error: null,
    });
    const res = await GET(get("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({ count: 2, boundaries: ["app", "root"] });
  });

  it("surfaces query failures as 502", async () => {
    result.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await GET(get("Bearer s3cret-value"))).status).toBe(502);
  });
});
