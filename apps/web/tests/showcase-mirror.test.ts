import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const r2 = vi.hoisted(() => ({ head: 404, put: 200, calls: [] as { method: string; key: string; bytes?: number }[] }));
vi.mock("../lib/agent/auth", () => ({ checkAdminBearer: (h: string | null) => (h === "Bearer ok" ? { ok: true } : { ok: false, diag: "x" }) }));
vi.mock("../lib/pool/r2", () => ({
  r2Configured: () => true,
  r2Request: async (method: string, key: string, body?: Buffer) => {
    r2.calls.push({ method, key, bytes: body?.length });
    return new Response(null, { status: method === "HEAD" ? r2.head : r2.put });
  },
}));

import { POST } from "../app/api/admin/showcase-mirror/route";

const mp3 = (n = 1000) => Buffer.concat([Buffer.from("ID3"), Buffer.alloc(n)]);
const post = (qs: string, body: Buffer | string = mp3(), auth = "Bearer ok") =>
  POST(new NextRequest(`http://x/api/admin/showcase-mirror?${qs}`, { method: "POST", headers: { authorization: auth }, body: new Uint8Array(Buffer.from(body)) }));

beforeEach(() => {
  r2.head = 404;
  r2.put = 200;
  r2.calls = [];
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/admin/showcase-mirror", () => {
  it("requires the admin bearer", async () => {
    expect((await post("name=a.mp3", mp3(), "Bearer no")).status).toBe(401);
    expect(r2.calls).toHaveLength(0);
  });

  it("accepts only plain lowercase mp3 names", async () => {
    expect((await post("name=e3-ta-a-1.mp3")).status).toBe(200);
    for (const bad of ["../x.mp3", "A.mp3", "a.wav", "a%2Fb.mp3", ".mp3", "a%20b.mp3"]) expect((await post(`name=${bad}`)).status).toBe(400);
  });

  it("stores the body under showcase/<name>", async () => {
    const res = await post("name=e3-ta-a-1.mp3");
    expect(await res.json()).toMatchObject({ key: "showcase/e3-ta-a-1.mp3", stored: true });
    expect(r2.calls.map((c) => `${c.method} ${c.key}`)).toEqual(["HEAD showcase/e3-ta-a-1.mp3", "PUT showcase/e3-ta-a-1.mp3"]);
  });

  it("keeps an object that already exists unless replace=1", async () => {
    r2.head = 200;
    expect(await (await post("name=a.mp3")).json()).toMatchObject({ stored: false, existed: true });
    expect(r2.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(await (await post("name=a.mp3&replace=1")).json()).toMatchObject({ stored: true });
  });

  it("refuses non-mp3 bodies, empty bodies and bad names", async () => {
    expect((await post("name=a.mp3", "hello world")).status).toBe(400);
    expect((await post("name=a.mp3", "")).status).toBe(400);
    expect((await post("name=../a.mp3")).status).toBe(400);
  });

  it("reports an R2 failure as 502", async () => {
    r2.put = 500;
    expect((await post("name=a.mp3")).status).toBe(502);
  });
});
