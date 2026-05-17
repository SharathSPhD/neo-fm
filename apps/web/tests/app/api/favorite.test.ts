/**
 * Tests for /api/songs/[id]/favorite (v1.4 Sprint 1).
 *
 * The route's contract did not change in Sprint 1 — only the underlying
 * RPC's security mode did (migration 0035 makes `toggle_favorite`
 * SECURITY DEFINER). These tests pin the route's behaviour so a future
 * regression in the favorites flow surfaces before the e2e gate.
 */
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../../app/api/songs/[id]/favorite/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>(
    "../../../lib/supabase/auth",
  );
  return { ...mod, requireUser: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";

const SONG_ID = "11111111-1111-1111-1111-111111111111";

function authed(supabase: FakeSupabase) {
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: "user-1" } as never,
    supabase: supabase as never,
  });
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/songs/[id]/favorite", () => {
  it("returns 400 for invalid song id", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const res = await POST(new Request("http://x"), { params: { id: "bad" } });
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await POST(new Request("http://x"), {
      params: { id: SONG_ID },
    });
    expect(res.status).toBe(401);
  });

  it("returns the new is_favorite value when the RPC succeeds", async () => {
    const s = makeFakeSupabase();
    s.__state.rpc_handlers.toggle_favorite = (args) => {
      const a = args as { p_job_id: string };
      expect(a.p_job_id).toBe(SONG_ID);
      return { data: [{ id: SONG_ID, is_favorite: true }], error: null };
    };
    authed(s);
    const res = await POST(new Request("http://x"), {
      params: { id: SONG_ID },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_favorite).toBe(true);
    expect(body.id).toBe(SONG_ID);
  });

  it("maps RPC 42501 to 403", async () => {
    const s = makeFakeSupabase();
    s.__state.rpc_handlers.toggle_favorite = () => ({
      data: null,
      error: { message: "not_owner", code: "42501" } as never,
    });
    authed(s);
    const res = await POST(new Request("http://x"), {
      params: { id: SONG_ID },
    });
    expect(res.status).toBe(403);
  });

  it("maps other RPC errors to 500", async () => {
    const s = makeFakeSupabase();
    s.__state.rpc_handlers.toggle_favorite = () => ({
      data: null,
      error: { message: "unexpected", code: "P0001" } as never,
    });
    authed(s);
    const res = await POST(new Request("http://x"), {
      params: { id: SONG_ID },
    });
    expect(res.status).toBe(500);
  });
});
