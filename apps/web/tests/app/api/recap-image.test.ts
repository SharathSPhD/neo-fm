import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({ requireUser: () => requireUser() }));
const loadRecap = vi.fn();
vi.mock("@/lib/recap/load", () => ({ loadRecap: (...a: unknown[]) => loadRecap(...a) }));

import { GET } from "@/app/api/recap/image/route";

const req = (qs = "") => new NextRequest(`http://localhost/api/recap/image${qs}`);

describe("GET /api/recap/image", () => {
  beforeEach(() => {
    requireUser.mockReset();
    loadRecap.mockReset();
  });
  it("requires a session", async () => {
    requireUser.mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await GET(req())).status).toBe(401);
    expect(loadRecap).not.toHaveBeenCalled();
  });
  it("rejects malformed and future months before touching the database", async () => {
    requireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
    expect((await GET(req("?month=2026-99"))).status).toBe(400);
    expect((await GET(req("?month=2999-01"))).status).toBe(400);
    expect(loadRecap).not.toHaveBeenCalled();
  });
  it("renders a private, non-cacheable PNG for the caller only", async () => {
    requireUser.mockResolvedValue({ user: { id: "u1" }, supabase: { tag: "session" } });
    loadRecap.mockResolvedValue({ songs: 0, languages: [], styles: [], moods: [], topSong: null, likes: 0, listens: 0, collections: { created: 0, added: 0 } });
    const res = await GET(req("?month=2026-10&lang=hi&download=1"));
    expect(res.status).toBe(200);
    expect(loadRecap.mock.calls[0]![1]).toBe("u1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toContain("2026-10-recap.png");
    expect(Buffer.from(await res.arrayBuffer()).subarray(1, 4).toString()).toBe("PNG");
  });
  it("hides failures behind a generic error", async () => {
    requireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
    loadRecap.mockRejectedValue(new Error("secret db detail"));
    const res = await GET(req("?month=2026-10"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
