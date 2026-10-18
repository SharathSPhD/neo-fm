import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SLOT = "41f1e639-1111-4222-8333-44445555aaaa";
const world = { slots: [] as Record<string, unknown>[] };

vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    from: (t: string) => {
      if (t === "ad_slots") return { select: () => ({ eq: async () => ({ data: world.slots }) }) };
      return { select: () => ({ eq: () => ({ gte: async () => ({ data: [] }) }) }) };
    },
    rpc: async () => ({ data: false, error: null }),
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` } }) }) },
  }),
}));
const LANGS = ["hi", "ta", "te"];
vi.mock("@/lib/station/pool", () => ({
  loadPool: async () => [
    ...Array.from({ length: 18 }, (_, i) => ({ id: `v${i}`, language: LANGS[i % 3]!, tags: ["calm"], title: `V${i}`, audioPath: `tracks/v${i}.mp3`, durationSeconds: 60, kind: "vocal" })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `i${i}`, language: "zxx", tags: ["calm"], title: `I${i}`, audioPath: `tracks/i${i}.mp3`, durationSeconds: 150, kind: "instrumental" })),
  ],
}));

import { requireUser } from "@/lib/supabase/auth";
import { GET } from "../app/api/station/queue/route";

type Item = { id: string; type?: string; kind?: string; language: string; set?: { id: string; index: number; size: number }; fadeInMs?: number; fadeOutMs?: number };
const items = async (qs = "") => ((await (await GET(new NextRequest(`http://x/api/station/queue?limit=10${qs.includes("hour=") ? "" : "&hour=10"}${qs}`))).json()) as { tracks: Item[] }).tracks;

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
  vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  world.slots = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("station sets in GET /api/station/queue", () => {
  it("changes nothing without STATION_SETS", async () => {
    const t = await items();
    expect(t.every((x) => x.set === undefined && x.fadeInMs === undefined)).toBe(true);
  });

  it("with STATION_SETS=1 returns sets with crossfade hints, one language per set", async () => {
    vi.stubEnv("STATION_SETS", "1");
    const t = await items();
    const sets = new Map<string, Item[]>();
    for (const x of t) if (x.set) sets.set(x.set.id, [...(sets.get(x.set.id) ?? []), x]);
    expect(sets.size).toBeGreaterThan(0);
    for (const block of sets.values()) {
      expect(new Set(block.map((x) => x.language)).size).toBe(1);
      expect(block[0]).toMatchObject({ fadeInMs: 0, fadeOutMs: 2500 });
      expect(block[block.length - 1]).toMatchObject({ fadeOutMs: 0 });
    }
  });

  it("serves instrumentals (language-neutral) to a language-locked listener", async () => {
    vi.stubEnv("STATION_SETS", "1");
    const t = await items("&lang=hi&hour=13"); // midday: 150 s of 510 s is under the 30% cap
    const vocals = t.filter((x) => x.kind !== "instrumental");
    expect(vocals.every((x) => x.language === "hi")).toBe(true);
    expect(t.some((x) => x.kind === "instrumental")).toBe(true);
  });

  it("never places an ad inside a set", async () => {
    vi.stubEnv("STATION_SETS", "1");
    vi.stubEnv("ADS_ENABLED", "1");
    world.slots = [{ id: SLOT, kind: "house", headline: "Gift", cta_label: "Gift", cta_url: "/gift", languages: [], dayparts: [], excluded_tags: [], ai_made: false, weight: 1, active: true, reviewed_at: "2026-11-01T00:00:00Z" }];
    const t = await items("&played=0");
    const adAt = t.findIndex((x) => x.type === "ad");
    expect(adAt).toBeGreaterThan(0);
    const before = t[adAt - 1]!;
    const after = t[adAt + 1];
    expect(!before.set || !after?.set || before.set.id !== after.set.id).toBe(true);
  });
});
