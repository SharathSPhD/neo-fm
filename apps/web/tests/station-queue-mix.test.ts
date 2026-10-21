import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const world = { pass: false, tier: "free" };

vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    from: (t: string) => {
      if (t === "users") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tier: world.tier } }) }) }) };
      return { select: () => ({ eq: () => ({ gte: async () => ({ data: [] }), then: undefined }) }) };
    },
    rpc: async () => ({ data: world.pass, error: null }),
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` } }) }) },
  }),
}));
const LANGS = ["hi", "ta", "kn"];
vi.mock("@/lib/station/pool", () => ({
  loadPool: async () => Array.from({ length: 45 }, (_, i) => ({ id: `v${i}`, language: LANGS[i % 3]!, tags: [Math.floor(i / 3) % 2 === 0 ? "calm" : "joyful"], title: `V${i}`, audioPath: `tracks/v${i}.mp3`, durationSeconds: 60, kind: "vocal" })),
}));

import { requireUser } from "@/lib/supabase/auth";
import { GET } from "../app/api/station/queue/route";

const langsOf = async (qs: string) =>
  ((await (await GET(new NextRequest(`http://x/api/station/queue?limit=12&hour=10${qs}`))).json()) as { tracks: { language: string }[] }).tracks.map((t) => t.language);

beforeEach(() => {
  world.pass = false;
  world.tier = "free";
  vi.mocked(requireUser).mockReset();
  vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } } as never);
  vi.stubEnv("STATION_PASS_MIX", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("language mix in GET /api/station/queue", () => {
  it("plays only the mixed languages in runs for a pass holder", async () => {
    world.pass = true;
    const l = await langsOf("&langs=ta:70,hi:30");
    expect(l.length).toBe(12);
    expect(new Set(l)).toEqual(new Set(["ta", "hi"]));
    expect(l.filter((x) => x === "ta").length).toBeGreaterThan(l.filter((x) => x === "hi").length);
  });

  it("includes Creator and Pro", async () => {
    world.tier = "pro";
    expect(new Set(await langsOf("&langs=kn,hi"))).toEqual(new Set(["kn", "hi"]));
  });

  it("ignores the mix for a free listener, a signed-out visitor and when the flag is off", async () => {
    expect(new Set(await langsOf("&langs=ta,hi")).size).toBe(3);
    world.pass = true;
    vi.stubEnv("STATION_PASS_MIX", "");
    expect(new Set(await langsOf("&langs=ta,hi")).size).toBe(3);
    vi.stubEnv("STATION_PASS_MIX", "1");
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect(new Set(await langsOf("&langs=ta,hi")).size).toBe(3);
  });

  it("applies mood picks only for pass perks", async () => {
    const pick = async () => (await (await GET(new NextRequest("http://x/api/station/queue?limit=6&hour=10&lang=hi&moods=joyful"))).json()) as { tracks: { tags: string[] }[] };
    const free = await pick();
    world.pass = true;
    const pass = await pick();
    const joy = (r: { tracks: { tags: string[] }[] }) => r.tracks.filter((t) => t.tags.includes("joyful")).length;
    expect(joy(pass)).toBeGreaterThanOrEqual(joy(free));
    expect(pass.tracks.length).toBeGreaterThan(0);
  });
});
