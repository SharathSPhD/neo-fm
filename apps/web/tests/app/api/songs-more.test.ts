/** POST/GET /api/songs: moderation gate, RPC error mapping not covered elsewhere, prompt persistence, and the list endpoint. */
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { screen } = vi.hoisted(() => ({ screen: vi.fn() }));
vi.mock("../../../lib/safety", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/safety")>("../../../lib/safety");
  return { ...mod, screenRequest: screen };
});
vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>("../../../lib/supabase/auth");
  return { ...mod, requireUser: vi.fn() };
});
import { requireUser } from "../../../lib/supabase/auth";
import { GET, POST } from "../../../app/api/songs/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

const JOB = "22222222-2222-2222-2222-222222222222";
const SONG = "11111111-1111-1111-1111-111111111111";
const post = (b: unknown) => new NextRequest("http://x/api/songs", { method: "POST", headers: { "content-type": "application/json" }, body: typeof b === "string" ? b : JSON.stringify(b) });
const promptBody = { prompt: "a monsoon lullaby", language: "en", style_family: "western", target_duration_seconds: 30 };

function client(rpc?: () => { data: unknown; error: { message: string } | null }): FakeSupabase {
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.create_song_job = rpc ?? (() => ({ data: [{ job_id: JOB, song_id: SONG, status: "queued" }], error: null }));
  return s;
}
const authed = (s: unknown) => vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } as never, supabase: s as never });

beforeEach(() => { vi.mocked(requireUser).mockReset(); screen.mockReset().mockResolvedValue({ allowed: true }); });

describe("POST /api/songs moderation and validation", () => {
  it("rejects a disallowed brief with 422 and never creates a job", async () => {
    const s = client(); authed(s);
    screen.mockResolvedValue({ allowed: false, category: "hate", reason: "not allowed" });
    const res = await POST(post(promptBody));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "content_policy", category: "hate" });
    expect(s.__state.rpc_calls).toHaveLength(0);
  });
  it("fails closed with 503 when moderation itself is unavailable", async () => {
    const s = client(); authed(s);
    screen.mockResolvedValue({ allowed: false, category: "moderation_unavailable", reason: "no key" });
    expect((await POST(post(promptBody))).status).toBe(503);
    expect(s.__state.rpc_calls).toHaveLength(0);
  });
  it("screens only the prompt branch, with the brief policy", async () => {
    authed(client());
    await POST(post(promptBody));
    expect(screen).toHaveBeenCalledWith("a monsoon lullaby", "brief");
  });
  it("401s and 400s before any moderation or RPC", async () => {
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await POST(post(promptBody))).status).toBe(401);
    authed(client());
    expect((await POST(post("{"))).status).toBe(400);
    expect(screen).not.toHaveBeenCalled();
  });
  it("persists the prompt in the stored document metadata", async () => {
    const s = client(); authed(s);
    await POST(post(promptBody));
    const args = s.__state.rpc_calls[0]!.args as { p_song_document: { metadata?: { prompt?: string } }; p_priority: number };
    expect(args.p_song_document.metadata?.prompt).toBe("a monsoon lullaby");
    expect(args.p_priority).toBe(0);
  });
});

describe("POST /api/songs RPC error mapping", () => {
  const run = async (message: string | null, data: unknown = null) => {
    authed(client(() => ({ data, error: message === null ? null : { message } })));
    return POST(post(promptBody));
  };
  it("concurrent cap -> 429 with its own error code (distinct from monthly quota)", async () => {
    const res = await run("concurrent_cap_exceeded");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "concurrent_cap_exceeded", reason: "in_flight_jobs" });
  });
  it("storage quota is checked before the generic quota match, and reports no reset time", async () => {
    const body = await (await run("storage_quota_exceeded")).json();
    expect(body).toMatchObject({ error: "quota_exceeded", reason: "storage_bytes", remaining_seconds_until_reset: -1 });
  });
  it("monthly quota reports a positive time until the UTC month rolls over", async () => {
    const body = await (await run("quota_exceeded")).json();
    expect(body.reason).toBe("rows_per_month");
    expect(body.remaining_seconds_until_reset).toBeGreaterThan(0);
    expect(body.remaining_seconds_until_reset).toBeLessThanOrEqual(31 * 86400);
  });
  it("unauthenticated -> 401; bad duration -> 400; unknown -> 500 with details", async () => {
    expect((await run("unauthenticated")).status).toBe(401);
    expect((await run("invalid_target_duration_seconds: 7")).status).toBe(400);
    const res = await run("kaboom");
    expect(res.status).toBe(500);
    expect((await res.json()).details).toBe("kaboom");
  });
  it("an empty RPC result is a 500, never a 202 without a job id", async () => {
    expect((await run(null, [])).status).toBe(500);
    expect((await run(null, null)).status).toBe(500);
  });
});

type Row = { id: string; created_at: string; tracks: { url: string; created_at: string }[] | null };
function listClient(rows: Row[] | null, error: { message: string } | null = null) {
  const calls: [string, ...unknown[]][] = [];
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "lt"]) b[m] = (...a: unknown[]) => { calls.push([m, ...a]); return b; };
  b.returns = async () => ({ data: rows, error });
  return { calls, supabase: { from: () => b } };
}
const gget = (qs = "") => new NextRequest(`http://x/api/songs${qs}`);

describe("GET /api/songs", () => {
  it("401s signed out", async () => {
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await GET(gget())).status).toBe(401);
  });
  it.each([["?limit=0"], ["?limit=101"], ["?limit=abc"]])("rejects %s", async (qs) => {
    authed(listClient([]).supabase);
    expect((await GET(gget(qs))).status).toBe(400);
  });
  it("defaults to 25 newest-first and applies the cursor as created_at < cursor", async () => {
    const l = listClient([]); authed(l.supabase);
    await GET(gget("?cursor=2026-10-01T00:00:00Z"));
    expect(l.calls).toContainEqual(["limit", 25]);
    expect(l.calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(l.calls).toContainEqual(["lt", "created_at", "2026-10-01T00:00:00Z"]);
  });
  it("returns the newest track per song, whatever order the database sent", async () => {
    const l = listClient([{ id: "a", created_at: "2026-10-02T00:00:00Z", tracks: [{ url: "old", created_at: "2026-10-02T01:00:00Z" }, { url: "new", created_at: "2026-10-02T05:00:00Z" }] }, { id: "b", created_at: "2026-10-01T00:00:00Z", tracks: null }]);
    authed(l.supabase);
    const body = await (await GET(gget())).json();
    expect(body.items[0].track.url).toBe("new");
    expect(body.items[1].track).toBeUndefined();
    expect(body.next_cursor).toBeUndefined(); // fewer rows than the page size: nothing more to fetch
  });
  it("emits next_cursor only when the page is full", async () => {
    const rows = [{ id: "a", created_at: "2026-10-03T00:00:00Z", tracks: [] }, { id: "b", created_at: "2026-10-02T00:00:00Z", tracks: [] }];
    authed(listClient(rows).supabase);
    expect((await (await GET(gget("?limit=2"))).json()).next_cursor).toBe("2026-10-02T00:00:00Z");
  });
  it("500s with list_failed on a database error and tolerates null data", async () => {
    authed(listClient(null, { message: "db" }).supabase);
    expect((await GET(gget())).status).toBe(500);
    authed(listClient(null).supabase);
    expect((await (await GET(gget())).json()).items).toEqual([]);
  });
});
