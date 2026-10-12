import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("../lib/agent/adapters", () => ({ serviceClient: () => ({ rpc }) }));

import { GET } from "../app/api/admin/purge-listens/route";

const req = (auth?: string) => new Request("https://x/api/admin/purge-listens", { headers: auth ? { authorization: auth } : {} }) as never;

describe("GET /api/admin/purge-listens", () => {
  beforeEach(() => { rpc.mockReset(); vi.stubEnv("CRON_SECRET", "s3cret"); });

  it("rejects callers without the cron secret and never touches the database", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("purges rows older than 90 days and reports the count", async () => {
    rpc.mockResolvedValue({ data: 12, error: null });
    const res = await GET(req("Bearer s3cret"));
    expect(rpc).toHaveBeenCalledWith("purge_song_listens", { p_keep_days: 90 });
    expect(await res.json()).toEqual({ ok: true, purged: 12 });
  });

  it("surfaces a database error as a 500", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await GET(req("Bearer s3cret"))).status).toBe(500);
  });
});
