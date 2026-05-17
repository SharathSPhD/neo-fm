/**
 * Tests for POST /api/songs/[id]/compare (v1.4 Sprint 16 RLHF).
 *
 * The route is a thin shell over the `record_preference_pair` RPC
 * (migration 0041); these tests pin auth, body validation, identical-
 * track rejection, vote-source mapping for tie votes, and SQLSTATE
 * translation.
 */
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../../app/api/songs/[id]/compare/route";
import { makeFakeSupabase, type FakeSupabase } from "../../fakes/supabase";

vi.mock("../../../lib/supabase/auth", async () => {
  const mod = await vi.importActual<typeof import("../../../lib/supabase/auth")>(
    "../../../lib/supabase/auth",
  );
  return { ...mod, requireUser: vi.fn() };
});

import { requireUser } from "../../../lib/supabase/auth";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const JOB_ID = "11111111-1111-1111-1111-111111111111";
const TRACK_A = "22222222-2222-2222-2222-222222222222";
const TRACK_B = "33333333-3333-3333-3333-333333333333";

function authed(supabase: FakeSupabase) {
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: USER_ID } as never,
    supabase: supabase as never,
  });
}

beforeEach(() => vi.mocked(requireUser).mockReset());
afterEach(() => vi.clearAllMocks());

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/songs/[id]/compare", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await POST(
      makeReq({
        winner_track_id: TRACK_A,
        loser_track_id: TRACK_B,
        choice: "A",
      }),
      { params: { id: JOB_ID } },
    );
    expect(res.status).toBe(401);
  });

  it("400 when job id is invalid", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const res = await POST(
      makeReq({
        winner_track_id: TRACK_A,
        loser_track_id: TRACK_B,
        choice: "A",
      }),
      { params: { id: "not-a-uuid" } },
    );
    expect(res.status).toBe(400);
  });

  it("400 when body missing fields", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const res = await POST(makeReq({ choice: "A" }), {
      params: { id: JOB_ID },
    });
    expect(res.status).toBe(400);
  });

  it("400 when choice is unknown", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const res = await POST(
      makeReq({
        winner_track_id: TRACK_A,
        loser_track_id: TRACK_B,
        choice: "neither",
      }),
      { params: { id: JOB_ID } },
    );
    expect(res.status).toBe(400);
  });

  it("422 when winner == loser", async () => {
    const s = makeFakeSupabase();
    authed(s);
    const res = await POST(
      makeReq({
        winner_track_id: TRACK_A,
        loser_track_id: TRACK_A,
        choice: "A",
      }),
      { params: { id: JOB_ID } },
    );
    expect(res.status).toBe(422);
  });

  it("happy path passes vote_source=compare-page for A/B", async () => {
    const s = makeFakeSupabase();
    let received: Record<string, unknown> | null = null;
    s.__state.rpc_handlers.record_preference_pair = (args) => {
      received = args as Record<string, unknown>;
      return { data: "pref-pair-id", error: null };
    };
    authed(s);
    const res = await POST(
      makeReq({
        winner_track_id: TRACK_A,
        loser_track_id: TRACK_B,
        choice: "A",
      }),
      { params: { id: JOB_ID } },
    );
    expect(res.status).toBe(200);
    expect(received).not.toBeNull();
    const args = received as unknown as Record<string, unknown>;
    expect(args["p_vote_source"]).toBe("compare-page");
    expect(args["p_winner_track_id"]).toBe(TRACK_A);
    expect(args["p_loser_track_id"]).toBe(TRACK_B);
  });

  it("tie vote sets vote_source=compare-page-tie", async () => {
    const s = makeFakeSupabase();
    let received: Record<string, unknown> | null = null;
    s.__state.rpc_handlers.record_preference_pair = (args) => {
      received = args as Record<string, unknown>;
      return { data: "pref-pair-id", error: null };
    };
    authed(s);
    const res = await POST(
      makeReq({
        winner_track_id: TRACK_A,
        loser_track_id: TRACK_B,
        choice: "tie",
      }),
      { params: { id: JOB_ID } },
    );
    expect(res.status).toBe(200);
    expect(
      (received as unknown as Record<string, unknown>)["p_vote_source"],
    ).toBe("compare-page-tie");
  });

  it("translates SQLSTATE 42501 -> 403", async () => {
    const s = makeFakeSupabase();
    s.__state.rpc_handlers.record_preference_pair = () => ({
      data: null,
      error: { message: "forbidden", code: "42501" } as never,
    });
    authed(s);
    const res = await POST(
      makeReq({
        winner_track_id: TRACK_A,
        loser_track_id: TRACK_B,
        choice: "A",
      }),
      { params: { id: JOB_ID } },
    );
    expect(res.status).toBe(403);
  });

  it("translates SQLSTATE P0002 -> 404", async () => {
    const s = makeFakeSupabase();
    s.__state.rpc_handlers.record_preference_pair = () => ({
      data: null,
      error: { message: "not found", code: "P0002" } as never,
    });
    authed(s);
    const res = await POST(
      makeReq({
        winner_track_id: TRACK_A,
        loser_track_id: TRACK_B,
        choice: "A",
      }),
      { params: { id: JOB_ID } },
    );
    expect(res.status).toBe(404);
  });

  it("translates SQLSTATE 22023 -> 422", async () => {
    const s = makeFakeSupabase();
    s.__state.rpc_handlers.record_preference_pair = () => ({
      data: null,
      error: { message: "validation", code: "22023" } as never,
    });
    authed(s);
    const res = await POST(
      makeReq({
        winner_track_id: TRACK_A,
        loser_track_id: TRACK_B,
        choice: "A",
      }),
      { params: { id: JOB_ID } },
    );
    expect(res.status).toBe(422);
  });
});
