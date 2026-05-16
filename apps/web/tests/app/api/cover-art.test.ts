/**
 * Tests for /api/songs/[id]/cover-art (v1.3 Sprint 3).
 *
 * The POST route now enqueues into pgmq via the SECURITY DEFINER RPC
 * `enqueue_cover_art_job`; it never calls a model. The GET route returns
 * the latest attempt status + (separately) the latest is_current=true
 * artefact's signed URL.
 */
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../../app/api/songs/[id]/cover-art/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>(
    "../../../lib/supabase/auth",
  );
  return { ...mod, requireUser: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const SONG_ID = "11111111-1111-1111-1111-111111111111";

function authed(supabase: FakeSupabase) {
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: USER_ID } as never,
    supabase: supabase as never,
  });
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/songs/[id]/cover-art", () => {
  it("returns 400 for invalid song id", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const res = await POST(new Request("http://x"), { params: { id: "nope" } });
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await POST(new Request("http://x"), { params: { id: SONG_ID } });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the song isn't found", async () => {
    const s = makeFakeSupabase();
    s.__state.select_singles["jobs"] = null;
    authed(s);
    const res = await POST(new Request("http://x"), { params: { id: SONG_ID } });
    expect(res.status).toBe(404);
  });

  it("returns 202 + attempt_id when enqueue succeeds", async () => {
    const s = makeFakeSupabase();
    s.__state.select_singles["jobs"] = {
      id: SONG_ID,
      song_documents: {
        title: "Saanjh Dhal Gayi",
        language: "hi",
        style_family: "hindustani",
        document_json: {
          raga: { name: "Bhairavi" },
          orchestration: { texture: "lush" },
        },
      },
    };
    s.__state.rpc_handlers.enqueue_cover_art_job = (args) => {
      const a = args as { p_attempt_id: string; p_prompt: string };
      expect(a.p_prompt).toContain("Album cover art");
      expect(a.p_prompt).toContain("hindustani");
      expect(a.p_prompt).toContain("raga Bhairavi");
      return {
        data: [
          {
            job_id: SONG_ID,
            attempt_id: a.p_attempt_id,
            status: "queued",
          },
        ],
        error: null,
      };
    };
    authed(s);
    const res = await POST(new Request("http://x"), { params: { id: SONG_ID } });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("queued");
    expect(typeof body.attempt_id).toBe("string");
    expect(body.prompt).toMatch(/Album cover art/);
  });

  it("maps RPC not_owner → 404", async () => {
    const s = makeFakeSupabase();
    s.__state.select_singles["jobs"] = {
      id: SONG_ID,
      song_documents: { title: "x", language: "hi", style_family: "hindustani", document_json: null },
    };
    s.__state.rpc_handlers.enqueue_cover_art_job = () => ({
      data: null,
      error: { message: "not_owner" } as never,
    });
    authed(s);
    const res = await POST(new Request("http://x"), { params: { id: SONG_ID } });
    expect(res.status).toBe(404);
  });

  it("maps RPC unauthenticated → 401", async () => {
    const s = makeFakeSupabase();
    s.__state.select_singles["jobs"] = {
      id: SONG_ID,
      song_documents: { title: "x", language: "hi", style_family: "hindustani", document_json: null },
    };
    s.__state.rpc_handlers.enqueue_cover_art_job = () => ({
      data: null,
      error: { message: "unauthenticated" } as never,
    });
    authed(s);
    const res = await POST(new Request("http://x"), { params: { id: SONG_ID } });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/songs/[id]/cover-art", () => {
  it("returns 400 for invalid song id", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const res = await GET(new Request("http://x"), { params: { id: "bad" } });
    expect(res.status).toBe(400);
  });

  it("returns { url: null, attempt: null } when nothing exists", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const res = await GET(new Request("http://x"), { params: { id: SONG_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBeNull();
    expect(body.attempt).toBeNull();
  });

  it("returns the latest attempt status + signed URL when both exist", async () => {
    const s = makeFakeSupabase();
    // Both probes share the makeFakeSupabase select_singles map, so we
    // can't distinguish "cover_art_attempts" vs "cover_art" entries
    // without per-table data. Use a per-table dispatcher.
    s.__state.select_singles["cover_art_attempts"] = {
      attempt_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      status: "completed",
      error: null,
      storage_path: `${USER_ID}/${SONG_ID}/attempt.png`,
      model_version: "fake-cover-art-0.1.0",
      created_at: "2026-05-15T22:00:00Z",
      updated_at: "2026-05-15T22:00:00Z",
    };
    s.__state.select_singles["cover_art"] = {
      url: `cover-art/${USER_ID}/${SONG_ID}/attempt.png`,
      created_at: "2026-05-15T22:00:00Z",
    };
    authed(s);
    const res = await GET(new Request("http://x"), { params: { id: SONG_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://signed.example.com/track.mp3");
    expect(body.attempt.status).toBe("completed");
  });
});
