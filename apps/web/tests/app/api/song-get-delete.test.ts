import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { processJobs, waitUntil } = vi.hoisted(() => ({ processJobs: vi.fn(), waitUntil: vi.fn() }));
vi.mock("../../../lib/agent/process", () => ({ processJobs }));
vi.mock("@vercel/functions", () => ({ waitUntil }));
let runs: unknown[] = [];
let listed: { name: string }[] = [];
let storageThrows = false;
const removed: string[][] = [];
let runsThrow = false;
vi.mock("../../../lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    storage: { from: () => ({
      list: async () => { if (storageThrows) throw new Error("storage down"); return { data: listed }; },
      remove: async (paths: string[]) => { removed.push(paths); return { data: [], error: null }; },
    }) },
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => { if (runsThrow) throw new Error("db"); return { data: runs }; } }) }) }),
  }),
}));
vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>("../../../lib/supabase/auth");
  return { ...mod, requireUser: vi.fn() };
});
import { requireUser } from "../../../lib/supabase/auth";
import { DELETE, GET } from "../../../app/api/songs/[id]/route";

const ID = "11111111-1111-1111-1111-111111111111";
const req = () => new Request("http://x") as never;

let row: Record<string, unknown> | null;
let selectError: { message: string } | null;
let signResult: { data: { signedUrl: string } | null; error: { message: string } | null };
let deleteResult: { error: { message: string } | null; count: number | null };
const signed: string[] = [];

function authed() {
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ maybeSingle: async () => ({ data: row, error: selectError }) }) }) }),
      delete: () => ({ eq: async () => deleteResult }),
    }),
    storage: { from: () => ({ createSignedUrl: async (p: string) => { signed.push(p); return signResult; } }) },
  };
  vi.mocked(requireUser).mockResolvedValue({ user: { id: "u1" } as never, supabase: supabase as never });
}
const job = (over: Record<string, unknown> = {}) => ({ id: ID, status: "completed", error: null, created_at: "2026-10-12T10:00:00Z", finished_at: "2026-10-12T10:07:00Z", song_document_id: "d1", song_documents: { id: "d1", title: "T" }, tracks: [], ...over });

beforeEach(() => {
  vi.mocked(requireUser).mockReset(); processJobs.mockReset().mockResolvedValue({}); waitUntil.mockReset();
  row = job(); selectError = null; signResult = { data: { signedUrl: "https://signed/x.mp3" }, error: null }; deleteResult = { error: null, count: 1 };
  runs = []; runsThrow = false; signed.length = 0; listed = []; storageThrows = false; removed.length = 0;
  process.env.GEMINI_API_KEY = "g"; process.env.MA_ENVIRONMENT_ID = "env_x";
});
afterEach(() => { delete process.env.GEMINI_API_KEY; delete process.env.MA_ENVIRONMENT_ID; });

describe("GET /api/songs/[id]", () => {
  it("401s when signed out and 400s a malformed id", async () => {
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await GET(req(), { params: { id: ID } })).status).toBe(401);
    authed();
    expect((await GET(req(), { params: { id: "not-a-uuid" } })).status).toBe(400);
  });
  it("404s when the row is not visible (RLS hides other users' jobs) and 500s on a database error", async () => {
    authed(); row = null;
    expect((await GET(req(), { params: { id: ID } })).status).toBe(404);
    selectError = { message: "boom" };
    expect((await GET(req(), { params: { id: ID } })).status).toBe(500);
  });
  it("signs the newest track with the bucket prefix stripped and reports stage done", async () => {
    authed();
    row = job({ tracks: [
      { id: "old", url: "tracks/j/1.mp3", duration_seconds: 10, format: "mp3", bytes: 1, expires_at: null, created_at: "2026-10-12T10:00:00Z" },
      { id: "new", url: "tracks/j/2.mp3", duration_seconds: 62, format: "mp3", bytes: 2, expires_at: null, created_at: "2026-10-12T10:05:00Z" },
    ] });
    const body = await (await GET(req(), { params: { id: ID } })).json();
    expect(signed).toEqual(["j/2.mp3"]);
    expect(body).toMatchObject({ stage: "done", status: "completed", track: { url: "https://signed/x.mp3", duration_seconds: 62 } });
    expect(waitUntil).not.toHaveBeenCalled();
  });
  it("500s with signing_failed instead of returning a track without a playable url", async () => {
    authed(); signResult = { data: null, error: { message: "no object" } };
    row = job({ tracks: [{ id: "t", url: "tracks/j/1.mp3", duration_seconds: 1, format: "mp3", bytes: 1, expires_at: null, created_at: "2026-10-12T10:00:00Z" }] });
    const res = await GET(req(), { params: { id: ID } });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("signing_failed");
  });
  it.each([["queued"], ["processing"]])("kicks a pull-advance for a %s job when the worker env is set", async (status) => {
    authed(); row = job({ status });
    await GET(req(), { params: { id: ID } });
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(processJobs).toHaveBeenCalledWith({ environmentId: "env_x", geminiKey: "g" }, ID);
  });
  it("does not advance when the worker env is missing", async () => {
    authed(); row = job({ status: "queued" }); delete process.env.GEMINI_API_KEY;
    await GET(req(), { params: { id: ID } });
    expect(waitUntil).not.toHaveBeenCalled();
  });
  it.each([
    [[], "starting"], [[{ session_id: "s", lyria_calls: 0, audio_path: null }], "writing"],
    [[{ session_id: "s", lyria_calls: 1, audio_path: null }], "rendering"], [[{ session_id: "s", lyria_calls: 1, audio_path: "j/1.mp3" }], "finishing"],
  ])("derives the cosmetic stage from the agent run (%j -> %s)", async (r, stage) => {
    authed(); row = job({ status: "processing" }); runs = r as unknown[];
    expect((await (await GET(req(), { params: { id: ID } })).json()).stage).toBe(stage);
  });
  it("a failing stage lookup never breaks the poll", async () => {
    authed(); row = job({ status: "processing" }); runsThrow = true;
    const res = await GET(req(), { params: { id: ID } });
    expect(res.status).toBe(200);
    expect((await res.json()).stage).toBe("starting");
  });
});

describe("DELETE /api/songs/[id]", () => {
  it("401s signed out, 400s bad id", async () => {
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await DELETE(req(), { params: { id: ID } })).status).toBe(401);
    authed();
    expect((await DELETE(req(), { params: { id: "x" } })).status).toBe(400);
  });
  it("deletes an owned job, 404s when RLS matched nothing, 500s on error", async () => {
    authed();
    expect(await (await DELETE(req(), { params: { id: ID } })).json()).toEqual({ deleted: true });
    deleteResult = { error: null, count: 0 };
    listed = [{ name: "1.mp3" }];
    expect((await DELETE(req(), { params: { id: ID } })).status).toBe(404);
    expect(removed).toEqual([]); // never touch storage for a job the caller does not own
    deleteResult = { error: { message: "fk" }, count: null };
    expect((await DELETE(req(), { params: { id: ID } })).status).toBe(500);
  });
  it("removes the job's audio objects after a successful delete", async () => {
    authed(); listed = [{ name: "1.mp3" }, { name: "2.mp3" }];
    expect((await DELETE(req(), { params: { id: ID } })).status).toBe(200);
    expect(removed).toEqual([[`${ID}/1.mp3`, `${ID}/2.mp3`]]);
  });
  it("a job with no audio skips the remove call, and a storage failure never fails the delete", async () => {
    authed();
    expect((await DELETE(req(), { params: { id: ID } })).status).toBe(200);
    expect(removed).toEqual([]);
    storageThrows = true;
    const res = await DELETE(req(), { params: { id: ID } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
  });
});
