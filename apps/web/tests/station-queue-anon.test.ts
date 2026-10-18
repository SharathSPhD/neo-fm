import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fromSpy = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    from: (t: string) => { fromSpy(t); return {}; },
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` } }) }) },
  }),
}));
vi.mock("@/lib/station/pool", () => ({
  loadPool: async () => [
    { id: "41f1e639-1111-4222-8333-444455556661", language: "hi", tags: ["calm"], title: "A", audioPath: "tracks/a.mp3", durationSeconds: 60 },
    { id: "41f1e639-1111-4222-8333-444455556662", language: "ta", tags: ["festive"], title: "B", audioPath: "tracks/b.mp3", durationSeconds: 60 },
  ],
}));

import { requireUser } from "@/lib/supabase/auth";
import { GET } from "../app/api/station/queue/route";

const get = (qs = "") => GET(new NextRequest(`http://x/api/station/queue${qs}`));

beforeEach(() => { fromSpy.mockReset(); vi.mocked(requireUser).mockReset(); });

describe("GET /api/station/queue for a signed-out visitor", () => {
  it("serves the pool without reading any listener signals", async () => {
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tracks: { id: string; url: string }[] };
    expect(body.tracks).toHaveLength(2);
    expect(body.tracks[0]!.url).toMatch(/^https:\/\/signed\//);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("caps the page size for visitors", async () => {
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    const res = await get("?limit=25");
    expect((await res.json()).tracks.length).toBeLessThanOrEqual(10);
  });
});

describe("GET /api/station/queue for a signed-in listener", () => {
  it("still reads the listener's signals", async () => {
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } } as never);
    await get();
    expect(fromSpy).toHaveBeenCalledWith("station_signals");
  });
});
