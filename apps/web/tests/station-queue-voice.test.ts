import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ gte: async () => ({ data: [] }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` } }) }) },
  }),
}));
vi.mock("@/lib/station/pool", () => ({
  loadPool: async () =>
    Array.from({ length: 8 }, (_, i) => ({ id: `41f1e639-1111-4222-8333-44445555000${i}`, language: "hi", tags: ["calm"], title: `T${i}`, audioPath: `tracks/${i}.mp3`, durationSeconds: 60 })),
}));

import { requireUser } from "@/lib/supabase/auth";
import { GET } from "../app/api/station/queue/route";

type Item = { id: string; type?: string; url: string; voice?: { lineId: string; aiMade: boolean } };
const items = async (qs = "") => ((await (await GET(new NextRequest(`http://x/api/station/queue?limit=8&hour=10${qs}`))).json()) as { tracks: Item[] }).tracks;

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
  vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  vi.stubEnv("STATION_VOICE_LINKS", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("voice links in GET /api/station/queue", () => {
  it("splices one AI-labelled static-file link after the first two tracks, greeting first", async () => {
    const t = await items();
    const v = t.filter((x) => x.type === "voice");
    expect(v).toHaveLength(1);
    expect(t.indexOf(v[0]!)).toBe(2);
    expect(v[0]).toMatchObject({ url: expect.stringMatching(/^\/voice\/ident-daypart\/hi-morning-\d\.mp3$/), voice: { aiMade: true } });
    expect(t).toHaveLength(9);
  });

  it("changes nothing when STATION_VOICE_LINKS is off", async () => {
    vi.stubEnv("STATION_VOICE_LINKS", "");
    expect((await items()).some((x) => x.type === "voice")).toBe(false);
  });

  it("follows the session counters: a link heard this session is not repeated and the cadence waits", async () => {
    const early = await items("&played=6&vsince=1&vn=1");
    expect(early.findIndex((x) => x.type === "voice")).toBe(2);
    expect(early.find((x) => x.type === "voice")?.url).toMatch(/\/host-link\//);
    const seen = encodeURIComponent("host-link/hi-morning-1,host-link/hi-morning-2,host-link/hi-morning-3,host-link/hi-morning-4");
    const t = await items(`&played=6&vsince=3&vn=1&vseen=${seen}`);
    expect(t.find((x) => x.type === "voice")?.url).toMatch(/\/ident-daypart\//);
  });

  it("keeps the plain queue when no rendered line fits the language", async () => {
    expect((await items("&lang=kn")).some((x) => x.type === "voice")).toBe(false);
  });
});
