/**
 * Tests for POST /api/songs/[id]/recover (Sprint C bug-b).
 *
 * The route is a very thin wrapper over the `recover_song_job` RPC.
 * These tests cover the four exception-string -> HTTP-status mappings
 * + the happy path, and also pin that the RPC is called with the
 * caller-supplied job id (so the SECURITY DEFINER function gets a
 * chance to enforce ownership server-side).
 */
import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../../app/api/songs/[id]/recover/route";
import { makeFakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>(
    "../../../lib/supabase/auth",
  );
  return { ...mod, requireUser: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";

const SONG_ID = "00000000-0000-0000-0000-000000000abc";

function makeRequest() {
  return new Request(
    `https://app.neo-fm.test/api/songs/${SONG_ID}/recover`,
    { method: "POST" },
  ) as unknown as Parameters<typeof POST>[0];
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/songs/[id]/recover", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeRequest(), { params: { id: SONG_ID } });
    expect(res.status).toBe(401);
  });

  it("400 on invalid song id", async () => {
    const supabase = makeFakeSupabase();
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: "u1" } as never,
      supabase: supabase as never,
    });
    const res = await POST(makeRequest(), { params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
  });

  it("happy path -> 200 with RPC result", async () => {
    const supabase = makeFakeSupabase();
    supabase.__state.rpc_handlers["recover_song_job"] = () => ({
      data: [
        {
          job_id: SONG_ID,
          attempt_id: "11111111-1111-1111-1111-111111111111",
          status: "queued",
        },
      ],
      error: null,
    });
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: "u1" } as never,
      supabase: supabase as never,
    });
    const res = await POST(makeRequest(), { params: { id: SONG_ID } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      job_id: SONG_ID,
      status: "queued",
    });
    expect(supabase.__state.rpc_calls[0]).toMatchObject({
      name: "recover_song_job",
      args: { p_job_id: SONG_ID },
    });
  });

  it("404 when RPC says job_not_found", async () => {
    const supabase = makeFakeSupabase();
    supabase.__state.rpc_handlers["recover_song_job"] = () => ({
      data: null,
      error: { message: "job_not_found" },
    });
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: "u1" } as never,
      supabase: supabase as never,
    });
    const res = await POST(makeRequest(), { params: { id: SONG_ID } });
    expect(res.status).toBe(404);
  });

  it("409 when RPC says not_recoverable", async () => {
    const supabase = makeFakeSupabase();
    supabase.__state.rpc_handlers["recover_song_job"] = () => ({
      data: null,
      error: {
        message: "not_recoverable: status=processing, tracks=0",
      },
    });
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: "u1" } as never,
      supabase: supabase as never,
    });
    const res = await POST(makeRequest(), { params: { id: SONG_ID } });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; details?: string };
    expect(body.error).toBe("not_recoverable");
    expect(body.details).toContain("processing");
  });

  it("500 on unknown RPC error", async () => {
    const supabase = makeFakeSupabase();
    supabase.__state.rpc_handlers["recover_song_job"] = () => ({
      data: null,
      error: { message: "boom" },
    });
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: "u1" } as never,
      supabase: supabase as never,
    });
    const res = await POST(makeRequest(), { params: { id: SONG_ID } });
    expect(res.status).toBe(500);
  });
});
