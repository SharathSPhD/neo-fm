import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/agent/adapters", () => ({
  serviceClient: () => ({
    from: (t: string) => ({
      select: () => {
        const rows = t === "station_signals"
          ? Array.from({ length: 5 }, (_, i) => [
              { user_id: `u${i}`, track_id: "t1", kind: "play", created_at: new Date().toISOString() },
            ]).flat()
          : t === "pool_tracks" ? [{ id: "t1", language: "kn" }] : [];
        const res = Promise.resolve({ data: rows, error: null });
        return { gte: () => Object.assign(Promise.resolve({ data: rows, error: null }), { limit: () => res, in: () => res }), in: () => res, limit: () => res };
      },
    }),
  }),
}));

import { GET } from "../../../app/api/admin/listening/route";

const get = (auth?: string) => new NextRequest("http://localhost/api/admin/listening", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => { process.env.CRON_SECRET = "s3cret-value"; });
afterEach(() => { delete process.env.CRON_SECRET; });

describe("GET /api/admin/listening", () => {
  it("requires the bearer secret", async () => {
    expect((await GET(get())).status).toBe(401);
  });

  it("returns aggregates by language and daypart without ids", async () => {
    const res = await GET(get("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overall.listeners).toBe(5);
    expect(body.by_language.kn.plays).toBe(5);
    expect(JSON.stringify(body)).not.toMatch(/u0|"t1"/);
  });
});
