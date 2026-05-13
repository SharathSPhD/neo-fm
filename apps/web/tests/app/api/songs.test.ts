/**
 * Tests for POST /api/songs (post Phase 4 hardening).
 *
 * After the adversarial review, job creation is a single SECURITY DEFINER
 * RPC (`public.create_song_job`) that atomically does quota + insert +
 * enqueue. The route's responsibilities are narrowed to: auth gate, Zod
 * validation, feature flag, RPC call, error translation.
 *
 * Goals:
 *   1. unauthenticated -> 401
 *   2. invalid body   -> 400
 *   3. prompt branch (flag off) -> 501
 *   4. happy path: RPC called with the right args, 202 returned
 *   5. quota_exceeded raised by RPC -> 429
 *   6. unknown RPC failure -> 500
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../../app/api/songs/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>(
    "../../../lib/supabase/auth",
  );
  return { ...mod, requireUser: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const SONG_ID = "11111111-1111-1111-1111-111111111111";

function makeUserClient(): FakeSupabase {
  const s = makeFakeSupabase();
  s.__state.rpc_handlers.create_song_job = () => ({
    data: [{ job_id: JOB_ID, song_id: SONG_ID, status: "queued" }],
    error: null,
  });
  return s;
}

function validBody() {
  return {
    song_document: {
      language: "en",
      style_family: "western",
      target_duration_seconds: 30,
      sections: [
        { id: "verse-1", type: "verse", target_seconds: 15 },
        { id: "chorus-1", type: "chorus", target_seconds: 15 },
      ],
    },
  };
}

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/songs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/songs", () => {
  beforeEach(() => {
    process.env.NEO_FM_PROMPT_BRANCH_ENABLED = "false";
  });

  it("401 when unauthenticated", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireUser).mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
  });

  it("400 on invalid body", async () => {
    const user_client = makeUserClient();
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });
    const res = await POST(req({ song_document: { language: "xx" } }));
    expect(res.status).toBe(400);
  });

  it("501 for prompt branch when flag is off", async () => {
    const user_client = makeUserClient();
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });
    const res = await POST(
      req({
        prompt: "a happy song",
        language: "en",
        style_family: "western",
        target_duration_seconds: 30,
      }),
    );
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe("prompt_branch_not_yet_enabled");
  });

  it("happy path: calls create_song_job with the validated document and returns 202", async () => {
    const user_client = makeUserClient();
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });

    const res = await POST(req(validBody()));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ job_id: JOB_ID, song_id: SONG_ID, status: "queued" });

    expect(user_client.__state.rpc_calls).toHaveLength(1);
    const call = user_client.__state.rpc_calls[0]!;
    expect(call.name).toBe("create_song_job");
    expect(call.args).toMatchObject({
      p_language: "en",
      p_style_family: "western",
      p_target_duration_seconds: 30,
      p_priority: 0,
    });
    // The route must NOT do any direct table inserts; the RPC owns the writes.
    expect(user_client.__state.inserted).toEqual([]);
  });

  it("429 when the RPC raises quota_exceeded", async () => {
    const user_client = makeUserClient();
    user_client.__state.rpc_handlers.create_song_job = () => ({
      data: null,
      error: { message: 'P0001: quota_exceeded\nWhere: PL/pgSQL function create_song_job' },
    });
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });

    const res = await POST(req(validBody()));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("quota_exceeded");
    expect(body.remaining_seconds_until_reset).toBeGreaterThanOrEqual(0);
  });

  it("500 on unknown RPC failure", async () => {
    const user_client = makeUserClient();
    user_client.__state.rpc_handlers.create_song_job = () => ({
      data: null,
      error: { message: "deadlock detected" },
    });
    vi.mocked(requireUser).mockResolvedValueOnce({
      user: { id: USER_ID } as never,
      supabase: user_client as never,
    });

    const res = await POST(req(validBody()));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("create_song_job_failed");
  });
});
