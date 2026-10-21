import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SLOT = "41f1e639-1111-4222-8333-44445555aaaa";
const world = { slot: true as boolean, uploaded: [] as { path: string; opts: unknown }[], updated: [] as Record<string, unknown>[] };
vi.mock("../../../lib/agent/adapters", () => ({
  serviceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: world.slot ? { id: SLOT } : null }) }) }),
      update: (row: Record<string, unknown>) => ({ eq: async () => { world.updated.push(row); return {}; } }),
    }),
    storage: { from: () => ({ upload: async (path: string, _b: unknown, opts: unknown) => { world.uploaded.push({ path, opts }); return {}; } }) },
  }),
}));

import { POST } from "../../../app/api/admin/ad-spots/route";

const post = (fields: Record<string, string>, file: boolean | number = true, auth: string | null = "Bearer adm") => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) fd.set("file", new File([new Uint8Array(typeof file === "number" ? file : 1000)], "a.mp3", { type: "audio/mpeg" }));
  return new NextRequest("http://localhost/api/admin/ad-spots", { method: "POST", headers: auth ? { authorization: auth } : {}, body: fd });
};

beforeEach(() => {
  process.env.ADMIN_SECRET = "adm";
  Object.assign(world, { slot: true, uploaded: [], updated: [] });
});
afterEach(() => {
  delete process.env.ADMIN_SECRET;
});

describe("POST /api/admin/ad-spots", () => {
  it("requires the admin secret", async () => {
    expect((await POST(post({ slot_id: SLOT, duration_seconds: "8" }, true, null))).status).toBe(401);
    expect(world.uploaded).toHaveLength(0);
  });

  it("rejects a bad slot id, a duration outside 5 to 30, and a missing or oversized file", async () => {
    expect((await POST(post({ slot_id: "nope", duration_seconds: "8" }))).status).toBe(400);
    expect((await POST(post({ slot_id: SLOT, duration_seconds: "40" }))).status).toBe(400);
    expect((await POST(post({ slot_id: SLOT, duration_seconds: "8" }, false))).status).toBe(400);
    expect((await POST(post({ slot_id: SLOT, duration_seconds: "8" }, 700_000))).status).toBe(400);
    expect(world.uploaded).toHaveLength(0);
  });

  it("404s an unknown slot", async () => {
    world.slot = false;
    expect((await POST(post({ slot_id: SLOT, duration_seconds: "8" }))).status).toBe(404);
  });

  it("uploads ads/<id>.mp3 and sets the slot's audio fields", async () => {
    const res = await POST(post({ slot_id: SLOT, duration_seconds: "7.2", ai_made: "true" }));
    expect(res.status).toBe(200);
    expect(world.uploaded[0]?.path).toBe(`ads/${SLOT}.mp3`);
    expect(world.updated[0]).toEqual({ audio_path: `ads/${SLOT}.mp3`, duration_seconds: 8, ai_made: true });
  });
});
