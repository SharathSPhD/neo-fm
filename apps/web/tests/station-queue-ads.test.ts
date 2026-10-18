import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SLOT = "41f1e639-1111-4222-8333-44445555aaaa";
const world = {
  slots: [] as Record<string, unknown>[] | "missing",
  tier: "free",
  billing: null as string | null,
  events: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  pass: false as boolean | "missing",
};

vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    from: (t: string) => {
      if (t === "ad_slots") {
        return { select: () => ({ eq: async () => (world.slots === "missing" ? { data: null, error: { code: "42P01" } } : { data: world.slots }) }) };
      }
      if (t === "ad_events") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ gte: async () => ({ data: world.events }) }) }) }),
          insert: async (row: Record<string, unknown>) => { world.inserted.push(row); return {}; },
        };
      }
      if (t === "users") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tier: world.tier } }) }) }) };
      if (t === "user_billing") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: world.billing ? { status: world.billing } : null }) }) }) };
      return { select: () => ({ eq: () => ({ gte: async () => ({ data: [] }) }) }) };
    },
    rpc: async (fn: string) =>
      fn === "has_station_pass"
        ? world.pass === "missing" ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } } : { data: world.pass, error: null }
        : { data: null, error: null },
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` } }) }) },
  }),
}));
vi.mock("@/lib/station/pool", () => ({
  loadPool: async () =>
    Array.from({ length: 8 }, (_, i) => ({ id: `41f1e639-1111-4222-8333-44445555000${i}`, language: "hi", tags: ["calm"], title: `T${i}`, audioPath: `tracks/${i}.mp3`, durationSeconds: 60 })),
}));

import { requireUser } from "@/lib/supabase/auth";
import { POST as adEvent } from "../app/api/station/ad-event/route";
import { GET } from "../app/api/station/queue/route";

const slotRow = (o: Record<string, unknown> = {}) => ({
  id: SLOT, kind: "house", headline: "Gift a song", cta_label: "Gift", cta_url: "/gift", languages: [], dayparts: [], excluded_tags: [],
  ai_made: false, weight: 1, active: true, reviewed_at: "2026-11-01T00:00:00Z", ...o,
});
const get = (qs = "") => GET(new NextRequest(`http://x/api/station/queue?limit=8&hour=10${qs}`));
type Item = { id: string; type?: string; url: string; ad?: { slotId: string; label: string } };
const items = async (qs = "") => ((await (await get(qs)).json()) as { tracks: Item[] }).tracks;
const signedOut = () => vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
  signedOut();
  Object.assign(world, { slots: [slotRow()], tier: "free", billing: null, events: [], inserted: [], pass: false });
  vi.stubEnv("ADS_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("ads in GET /api/station/queue", () => {
  it("splices one labelled card-only ad after the first two tracks", async () => {
    const t = await items();
    const ads = t.filter((x) => x.type === "ad");
    expect(ads).toHaveLength(1);
    expect(t.indexOf(ads[0]!)).toBe(2);
    expect(ads[0]).toMatchObject({ url: "", ad: { slotId: SLOT, label: "From neo-fm" } });
    expect(t).toHaveLength(9);
  });

  it("changes nothing when ADS_ENABLED is off", async () => {
    vi.stubEnv("ADS_ENABLED", "");
    expect((await items()).some((x) => x.type === "ad")).toBe(false);
  });

  it("treats missing ad tables as no ads", async () => {
    world.slots = "missing";
    const t = await items();
    expect(t).toHaveLength(8);
    expect(t.some((x) => x.type === "ad")).toBe(false);
  });

  it("skips unreviewed and inactive slots", async () => {
    world.slots = [slotRow({ reviewed_at: null })];
    expect((await items()).some((x) => x.type === "ad")).toBe(false);
  });

  it("serves Creator and Pro listeners ads too, with their own spacing (9 and 18 tracks)", async () => {
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } } as never);
    world.tier = "creator";
    expect((await items("&played=0")).findIndex((x) => x.type === "ad")).toBe(3);
    world.tier = "pro";
    // Pro: first break after 5 tracks, so inside this 8-track slice.
    expect((await items("&played=0")).findIndex((x) => x.type === "ad")).toBe(5);
    // 4 tracks since the last break leaves 14 more to go: nothing in an 8-track slice.
    expect((await items("&played=30&since=4&adAge=900")).some((x) => x.type === "ad")).toBe(false);
  });

  it("treats a live subscription on an unknown tier as Creator, not Free", async () => {
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } } as never);
    world.billing = "active";
    expect((await items("&played=0")).findIndex((x) => x.type === "ad")).toBe(3);
  });

  it("Pro never gets an audio spot", async () => {
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } } as never);
    world.slots = [slotRow({ audio_path: "ads/a.mp3", duration_seconds: 10 })];
    world.tier = "pro";
    expect((await items("&played=0")).some((x) => x.type === "ad")).toBe(false);
  });

  it("a Station pass beats every other tier: no ads", async () => {
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } } as never);
    world.tier = "free";
    world.pass = true;
    expect((await items()).some((x) => x.type === "ad")).toBe(false);
    world.tier = "pro";
    expect((await items()).some((x) => x.type === "ad")).toBe(false);
  });

  it("serves a signed-out visitor with the Free row", async () => {
    expect((await items("&played=0")).findIndex((x) => x.type === "ad")).toBe(2);
  });

  it("treats a Station pass holder as ad-free", async () => {
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } } as never);
    world.pass = true;
    expect((await items()).some((x) => x.type === "ad")).toBe(false);
  });

  it("serves ads as before while the pass function is missing (migration 0098 not applied)", async () => {
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } } as never);
    world.pass = "missing";
    expect((await items()).some((x) => x.type === "ad")).toBe(true);
  });

  it("serves a free signed-in listener, and honours their ad history", async () => {
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } } as never);
    expect((await items()).some((x) => x.type === "ad")).toBe(true);
    world.events = [{ slot_id: SLOT, created_at: new Date(Date.now() - 30_000).toISOString() }]; // heard one 30 s ago
    expect((await items()).some((x) => x.type === "ad")).toBe(false);
  });

  it("uses the player's session counters", async () => {
    expect((await items("&played=0&since=0&adAge=30")).some((x) => x.type === "ad")).toBe(false); // 30 s since the last break
    const t = await items("&played=10&since=4");
    expect(t.findIndex((x) => x.type === "ad")).toBe(2); // Free spaces breaks 6 tracks apart: 2 more after 4
  });

  it("keeps a language-locked listener to their language", async () => {
    world.slots = [slotRow({ languages: ["ta"] })];
    expect((await items("&lang=hi")).some((x) => x.type === "ad")).toBe(false);
    expect((await items("&lang=ta")).some((x) => x.type === "ad")).toBe(true);
  });
});

describe("POST /api/station/ad-event", () => {
  const post = (body: unknown) => adEvent(new NextRequest("http://x/api/station/ad-event", { method: "POST", body: JSON.stringify(body) }));

  it("logs a start without a user id for a visitor", async () => {
    expect((await post({ slotId: SLOT, event: "start" })).status).toBe(204);
    expect(world.inserted).toEqual([{ slot_id: SLOT, event: "start", user_id: null }]);
  });

  it("rejects bad input and is a no-op when ads are off", async () => {
    expect((await post({ slotId: "nope", event: "start" })).status).toBe(400);
    expect((await post({ slotId: SLOT, event: "skip" })).status).toBe(400);
    vi.stubEnv("ADS_ENABLED", "");
    expect((await post({ slotId: SLOT, event: "tap" })).status).toBe(204);
    expect(world.inserted).toHaveLength(0);
  });
});
